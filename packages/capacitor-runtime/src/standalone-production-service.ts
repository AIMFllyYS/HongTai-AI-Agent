import {
  alignNarrationWordsWithWhisper,
  applyProductionPlanEdit,
  AssetInsightFlow,
  buildNarrationTimingInstructionPlan,
  cleanNarrationSpeechText,
  contentAnalysisResultSchema,
  createAvatarCaptionPlan,
  MIMO_CHAT_AUDIO_TTS_INSTRUCTION,
  MAX_DECORATIONS_PER_PLAN,
  ProductionPlanningFlow,
  replicaBlueprintResultSchema,
  requestedSubtitleTemplateId,
  ScriptGenerationFlow,
  STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION,
  validateMeasuredProductionPlan,
  withMeasuredSubtitleTimeline,
  type AiProvider,
  type AiStreamEvent,
  type DecorationIntent,
  type NarrationSentenceTimingInstruction,
  type ProductionPlanConstraints,
  type ProductionPlanningAsset,
} from "@hongtai/ai";
import {
  createRuntimeId,
  DECORATION_IDS,
  estimateScriptSentenceMs,
  inspectNarrationReadiness,
  inspectProductionPlanReadiness,
  inspectScriptStoryboardReadiness,
  isAvatarVideoAsset,
  isDecorationId,
  isMontageVisualAsset,
  issueFromAppError,
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SCRIPT_SENTENCE_CHARACTERS,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  planAvatarSourceWindows,
  PRODUCTION_TEXT_PRESET_VALUES,
  TaskError,
  type MeasuredDurationViolation,
} from "@hongtai/core";
import type {
  AnalysisService,
  ProductionAssetRecovery,
  ProductionEvent,
  ProductionMode,
  ProductionPlanUpdate,
  ProductionProjectRecord,
  ProductionService,
  ProductionTextPreset,
  ReplicaService,
  RuntimeUnfinishedWork,
  ScriptSentence,
  SubtitleCueWordTiming,
  TaskService,
  TtsTimingAlignmentSource,
} from "@hongtai/core";

import { persistedRuntimeWork, runtimeInterruptedIssue } from "./runtime-interruption.js";
import type { RuntimeOperationIdentity, RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import type { NativeNarrationSentenceInstruction, NativeNarrationSentenceOutcome, NativeProductionAsset, StandaloneProductionRuntimePlugin } from "./standalone-bridge.js";
import {
  assertImportAllowed,
  bindImportedAssets,
  dropPendingRequirement,
  importSelectionOf,
  remainingAssetSlots,
} from "./standalone-production-assets.js";
import { productionArtifactError, productionTaskError, storageTaskError } from "./standalone-production-native-errors.js";
import {
  assetPath,
  defaultAssetRole,
  originalSourceText,
  pairedNarration,
  parseProject,
  PLAN_PATH,
  planningAsset,
  PROJECT_PATH,
  subtitleTemplatePayload,
  toProductionProjectRecord,
  type PersistedAsset,
  type PersistedInsight,
  type PersistedProject,
  type ProductionFilesPort,
} from "./standalone-production-record.js";
import {
  narrationProgressEvent,
  PRODUCTION_AUTOMATIC_PIPELINE_RESULT_VERSION,
  PRODUCTION_MEASURED_PLAN_RESULT_VERSION,
  toNarrationRecord,
  toScriptRecord,
  type AutomaticPipelineResult,
  type MeasuredPlanComposeResult,
  type ProductionNarrationFailure,
  type ProductionNarrationRecord,
  type ProductionScriptRecord,
  type StandaloneProductionEvent,
} from "./standalone-production-script.js";

export interface StandaloneProductionServiceOptions {
  readonly files: ProductionFilesPort;
  readonly native: StandaloneProductionRuntimePlugin;
  readonly analysis: AnalysisService;
  /**
   * Reads the material list an asset was filmed against. Only consulted when a project actually has
   * bound assets, and a failure there fails the plan rather than silently dropping the ordering
   * promise the wizard made.
   */
  readonly blueprints?: Pick<ReplicaService, "get">;
  readonly tasks: Pick<TaskService, "getDetail">;
  readonly getProvider: () => Promise<AiProvider>;
  /** App logic decides whether a saved connection has an executable cloud narration path. */
  readonly getNarrationMode: () => Promise<"system" | "provider">;
  /**
   * v4 逐句配音的连接只读快照：transport 决定词级时间戳策略，`baseUrl`+`asrModel` 决定
   * 能否做 Whisper 转写反查。省略（或返回 null）表示没有可用云端配音——合成仍可走系统
   * 语音，只是字幕边界退回实测句长比例（`tts_duration`），不编造词级时间戳。
   */
  readonly getNarrationConnection?: () => Promise<{
    readonly ttsTransport: string | null;
    readonly ttsModel: string | null;
    readonly ttsVoice: string | null;
    readonly baseUrl: string;
    readonly asrModel: string | null;
  } | null>;
  readonly toDisplayUri: (uri: string) => string;
  readonly createProjectId?: () => string;
  readonly now?: () => Date;
  readonly operations?: RuntimeOperationRegistry;
}

function throwIfNotReadyToPlan(project: PersistedProject): void {
  const readiness = inspectProductionPlanReadiness({
    mode: project.mode,
    assets: project.assets.map((asset) => ({
      role: asset.role ?? defaultAssetRole(asset),
      kind: asset.kind,
      durationSeconds: asset.durationSeconds,
    })),
    avatarScript: project.avatarScript,
    targetDurationSeconds: project.targetDurationSeconds,
  });
  if (readiness.ok) return;
  if (readiness.reason === "need-visuals") {
    throw productionArtifactError(`素材剪辑模式至少需要${MIN_MONTAGE_VISUAL_ASSETS}个图片或视频素材`, "select_media");
  }
  if (readiness.reason === "avatar-too-short") {
    throw new TaskError({
      code: "MEDIA_DURATION_EXCEEDED",
      message: `数字人口播视频时长不足 ${project.targetDurationSeconds} 秒，请选择更长的视频或缩短目标时长。`,
      action: "select_media",
    });
  }
  throw productionArtifactError("请上传一个数字人口播视频并填写对应口播稿", "select_media");
}

export class StandaloneProductionService implements ProductionService {
  readonly #options: StandaloneProductionServiceOptions;
  readonly #listeners = new Map<string, Set<(event: StandaloneProductionEvent) => void | Promise<void>>>();
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(options: StandaloneProductionServiceOptions) { this.#options = options; }

  async create(input: { readonly analysisTaskId: string; readonly brief: string; readonly targetDurationSeconds: number; readonly mode?: ProductionMode; readonly avatarScript?: string; readonly headlineText?: string; readonly textPreset?: ProductionTextPreset }): Promise<ProductionProjectRecord> {
    const brief = input.brief.trim();
    if (!brief) throw productionArtifactError("请填写制作需求");
    if (input.targetDurationSeconds < MIN_PRODUCTION_DURATION_SECONDS || input.targetDurationSeconds > MAX_PRODUCTION_DURATION_SECONDS) {
      throw productionArtifactError("制作时长必须在15到60秒之间");
    }
    const mode = input.mode ?? "montage";
    const avatarScript = input.avatarScript?.trim();
    const headlineText = input.headlineText?.trim();
    const textPreset = input.textPreset ?? "classic_top";
    if (mode !== "montage" && mode !== "avatar") throw productionArtifactError("制作模式无效");
    if (input.headlineText !== undefined && (!headlineText || headlineText.length > 24)) throw productionArtifactError("主文字必须在1到24个字符之间");
    if (!PRODUCTION_TEXT_PRESET_VALUES.includes(textPreset)) throw productionArtifactError("文字预设无效");
    const projectId = this.#options.createProjectId?.() ?? createRuntimeId();
    const timestamp = (this.#options.now ?? (() => new Date()))().toISOString();
    const project: PersistedProject = {
      projectId,
      analysisTaskId: input.analysisTaskId,
      brief,
      mode,
      textPreset,
      ...(headlineText ? { headlineText } : {}),
      // v4 数字人项目：脚本由 AI 按需求生成，口播稿只是 v3 存量路径的兼容输入。
      ...(mode === "avatar" && avatarScript ? { avatarScript } : {}),
      targetDurationSeconds: input.targetDurationSeconds,
      status: "draft",
      assets: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#options.files.ensureProduction({ projectId });
    await this.#save(project);
    return this.#project(project);
  }

  async get(projectId: string): Promise<ProductionProjectRecord | undefined> {
    await this.#recoverProject(projectId);
    const project = await this.#readPersisted(projectId);
    return project ? this.#project(project) : undefined;
  }

  async list(): Promise<readonly ProductionProjectRecord[]> {
    const { projectIds } = await this.#options.files.listProductionIds();
    await Promise.all(projectIds.map(async (id) => {
      try {
        await this.#recoverProject(id);
      } catch {
        // One stuck project must not hide the rest of the workbench.
      }
    }));
    const projects = await Promise.all(projectIds.map(async (id) => {
      const project = await this.#readPersisted(id);
      return project ? this.#project(project) : undefined;
    }));
    return projects.filter((value): value is ProductionProjectRecord => Boolean(value)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async importAssets(projectId: string, options?: { readonly requirementOrder?: number }): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "transient-operation", id: `production-assets:${projectId}`, execution: "external-activity" },
      () => this.#importAssets(projectId, options?.requirementOrder),
    ));
  }

  async #importAssets(projectId: string, requirementOrder?: number): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    assertImportAllowed(project, requirementOrder);
    const selection = importSelectionOf(project);
    if (requirementOrder === undefined) {
      // An earlier pick can have died with the WebView and left its marker behind — a cancelled or
      // failed external Activity never comes back to clear it. This import was not made for that
      // item, so the marker goes before the picker opens rather than silently marking whatever the
      // user adds here as the material for it. Together with the overwrite below, a marker can then
      // only ever describe the pick currently in flight.
      project = await this.#withoutPendingRequirement(project);
    } else {
      // Recorded before the picker leaves the app, so a rebuilt WebView still knows what the
      // returned file was chosen for.
      project = await this.#persist({ ...project, pendingRequirementOrder: requirementOrder }, { emit: false });
    }
    let result;
    try {
      result = await this.#options.native.pickAssets({ projectId, maxItems: requirementOrder !== undefined || selection === "avatar" ? 1 : remainingAssetSlots(project), selection });
    } catch (error) {
      await this.#clearPendingRequirement(projectId).catch(() => undefined);
      throw productionTaskError(error, "素材没有导入成功");
    }
    return this.#applyImportedAssets(project, result.assets);
  }

  /** A cancelled or failed pick must not leave the next import silently attached to the old item. */
  async #clearPendingRequirement(projectId: string): Promise<void> {
    await this.#withoutPendingRequirement(await this.#required(projectId));
  }

  async #withoutPendingRequirement(project: PersistedProject): Promise<PersistedProject> {
    const next = dropPendingRequirement(project);
    if (next === project) return project;
    return this.#persist(next, { emit: false });
  }

  async consumeAssetRecovery(): Promise<ProductionAssetRecovery> {
    let recovered;
    try {
      recovered = await this.#options.native.consumeAssetOperation();
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(productionTaskError(error, "素材没有导入成功")) };
    }
    if (recovered.status === "none") {
      // Native returns none both when nothing is waiting and while the original picker is still
      // live. Clearing `pendingRequirementOrder` here would unbind a pick that is about to return.
      return { status: "none" };
    }
    if (recovered.status === "failed") {
      return { status: "failed", issue: issueFromAppError(productionTaskError({ code: recovered.code }, "素材没有导入成功")) };
    }
    try {
      return {
        status: "succeeded",
        project: await this.#exclusive(recovered.projectId, async () => {
          const project = await this.#required(recovered.projectId);
          return this.#applyImportedAssets(project, recovered.assets);
        }),
      };
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(productionTaskError(error, "素材没有导入成功")) };
    }
  }

  async #applyImportedAssets(project: PersistedProject, assets: readonly NativeProductionAsset[]): Promise<ProductionProjectRecord> {
    const bound = bindImportedAssets(project, assets);
    if (bound.status === "rejected") {
      if (bound.clearPending) await this.#clearPendingRequirement(project.projectId).catch(() => undefined);
      throw bound.error;
    }
    return this.#project(await this.#persist(bound.project));
  }

  async generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#generatePlan(projectId),
    ));
  }

  async #generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    throwIfNotReadyToPlan(project);
    const visualAssets = project.assets.filter((asset) => isMontageVisualAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind }));
    const avatarAssets = project.assets.filter((asset) => isAvatarVideoAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind }));
    const { plan: _plan, output: _output, issue: _issue, ...planningBase } = project;
    void _plan; void _output; void _issue;
    project = await this.#persist({ ...planningBase, status: "planning" });
    try {
      const record = await this.#options.analysis.get(project.analysisTaskId);
      const parsed = record?.status === "succeeded" && record.result?.schemaVersion === "content-analysis.v1"
        ? contentAnalysisResultSchema.safeParse(record.result.document) : undefined;
      if (!parsed?.success) throw productionArtifactError("来源任务尚无可用的正式拆解结果");
      const sourceText = originalSourceText(await this.#options.tasks.getDetail(project.analysisTaskId));
      if (!sourceText) throw productionArtifactError("来源任务没有可用于参考的原始文稿");
      if (project.mode === "montage") project = await this.#describeAssets(project, visualAssets);
      const plan = project.mode === "avatar"
        ? createAvatarCaptionPlan({
          analysisTaskId: project.analysisTaskId,
          brief: project.brief,
          targetDurationSeconds: project.targetDurationSeconds,
          avatarScript: project.avatarScript ?? "",
          headlineText: project.headlineText,
          textPreset: project.textPreset,
          avatarAsset: avatarAssets[0]!,
        })
        : await new ProductionPlanningFlow({ provider: await this.#options.getProvider() }).run({
          analysisTaskId: project.analysisTaskId,
          brief: project.brief,
          mode: project.mode,
          originalSourceText: sourceText,
          headlineText: project.headlineText,
          textPreset: project.textPreset,
          targetDurationSeconds: project.targetDurationSeconds,
          analysis: parsed.data,
          assets: await this.#planningAssets(project),
          // The stickers shipped inside this APK. Leaving it out is not "no stickers": it is an
          // empty allow-list, so every selection the model makes fails validation and the whole
          // plan is rejected.
          allowedDecorationIds: [...DECORATION_IDS],
        });
      await this.#options.files.writeProductionText({ projectId, relativePath: PLAN_PATH, value: JSON.stringify(plan), replace: true });
      return this.#project(await this.#persist({ ...project, status: "ready", plan }));
    } catch (error) {
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "制作计划没有完成", action: "retry" }) });
      throw error;
    }
  }

  // ============================ v4（文稿先行）管线 ============================

  /** 生成或重新生成分镜脚本。重新生成会作废旧句子 id 上的配音、计划与成片。 */
  async generateScript(projectId: string, input?: { readonly brief?: string }): Promise<ProductionScriptRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#generateScript(projectId, input),
    ));
  }

  async getScript(projectId: string): Promise<ProductionScriptRecord | undefined> {
    const project = await this.#readPersisted(projectId);
    return project ? toScriptRecord(project) : undefined;
  }

  async #generateScript(projectId: string, input?: { readonly brief?: string }): Promise<ProductionScriptRecord> {
    let project = await this.#required(projectId);
    this.#requireIdle(project);
    const brief = input?.brief !== undefined ? input.brief.trim() : project.brief;
    if (!brief) throw productionArtifactError("请填写制作需求");
    // A regenerated storyboard mints fresh sentence ids, so everything keyed to the old ids is
    // honestly unusable: narration audio, the measured plan and any rendered output go now.
    // Record first, delete after: a failed persist keeps the old record and its files intact,
    // and a failed delete only leaves orphans the new record no longer references.
    const obsoleteFiles = [
      ...(project.narrationAssets ?? []).map((asset) => asset.audioPath),
      ...(project.output ? ["output.mp4" as const] : []),
    ];
    const { plan: _plan, output: _output, issue: _issue, storyboard: _storyboard, narrationTracks: _tracks, narrationAssets: _assets, ...base } = project;
    void _plan; void _output; void _issue; void _storyboard; void _tracks; void _assets;
    project = await this.#persist({ ...base, ...(input?.brief !== undefined ? { brief } : {}), status: "planning" });
    for (const relativePath of obsoleteFiles) {
      await this.#options.files.deleteProductionFile({ projectId, relativePath }).catch(() => undefined);
    }
    try {
      // v4 拆解是可选增强：读得到就参考，读不到也不阻塞生成（与 v3 计划的硬前置不同）。
      const analysisRecord = await this.#options.analysis.get(project.analysisTaskId).catch(() => undefined);
      const parsed = analysisRecord?.status === "succeeded" && analysisRecord.result?.schemaVersion === "content-analysis.v1"
        ? contentAnalysisResultSchema.safeParse(analysisRecord.result.document) : undefined;
      if (project.mode === "montage") {
        project = await this.#describeAssets(project, project.assets.filter((asset) => isMontageVisualAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind })));
      }
      // 原创性校验前移到生成期：参考原文与 compose 路径同一来源，读不到则跳过。
      const sourceText = originalSourceText(await this.#options.tasks.getDetail(project.analysisTaskId).catch(() => undefined));
      const storyboard = await new ScriptGenerationFlow({
        provider: await this.#options.getProvider(),
        // 流式进度：delta 轻量聚合后以 script-progress 事件发给界面，只做运行期展示。
        onEvent: this.#scriptProgressListener(projectId),
      }).run({
        brief,
        mode: project.mode,
        ...(parsed?.success ? { analysis: parsed.data } : {}),
        assets: project.assets.map(planningAsset),
        ...(sourceText ? { originalSourceText: sourceText } : {}),
      });
      const saved = await this.#persist({ ...project, status: "draft", storyboard });
      const record = toScriptRecord(saved);
      if (!record) throw productionArtifactError("分镜脚本没有保存成功");
      return record;
    } catch (error) {
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "分镜脚本没有完成", action: "retry" }) });
      throw error;
    }
  }

  /**
   * 分镜脚本生成的流式进度监听器：把 provider 的 delta 轻量聚合（累计 ≥48 字符或距
   * 上次发射 ≥120ms 才 emit，完成即冲刷）后以 `script-progress` 事件发给界面。正文与
   * 推理文本都只存在于本次生成的运行期内存，绝不写入 project.json。
   */
  #scriptProgressListener(projectId: string): (event: AiStreamEvent, meta: { readonly phase: "generating" | "repairing" }) => Promise<void> {
    let phase: "generating" | "repairing" = "generating";
    let pendingContent = "";
    let pendingReasoning = "";
    let receivedCharacters = 0;
    let lastEmitAt = Date.now();

    const flush = async (): Promise<void> => {
      if (pendingContent.length === 0 && pendingReasoning.length === 0) return;
      await this.#emit(projectId, {
        type: "script-progress",
        projectId,
        phase,
        ...(pendingContent.length > 0 ? { contentDelta: pendingContent } : {}),
        ...(pendingReasoning.length > 0 ? { reasoningDelta: pendingReasoning } : {}),
        receivedCharacters,
      });
      pendingContent = "";
      pendingReasoning = "";
      lastEmitAt = Date.now();
    };

    return async (event, meta) => {
      if (meta.phase !== phase) {
        await flush();
        phase = meta.phase;
      }
      if (event.type === "content_delta") {
        pendingContent += event.delta;
        receivedCharacters += event.delta.length;
      } else if (event.type === "reasoning_delta") {
        pendingReasoning += event.delta;
      } else if (event.type === "completed") {
        await flush();
        return;
      }
      if (pendingContent.length >= 48 || Date.now() - lastEmitAt >= 120) await flush();
    };
  }

  /**
   * 逐句合成配音并把实测音轨（与音频文件路径）持久化到项目。单句失败不影响其余句；
   * `sentenceIds` 指定只（重）合成哪些句子，缺省补齐所有还没就绪的句子。
   */
  async synthesizeNarration(projectId: string, input?: {
    readonly sentenceIds?: readonly string[];
    readonly speechRate?: number;
  }): Promise<ProductionNarrationRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "transient-operation", id: `production-narration:${projectId}`, execution: "in-process" },
      () => this.#synthesizeNarration(projectId, input),
    ));
  }

  async getNarration(projectId: string): Promise<ProductionNarrationRecord | undefined> {
    const project = await this.#readPersisted(projectId);
    if (!project?.storyboard) return undefined;
    const mode = project.mode === "montage" ? await this.#options.getNarrationMode() : "system";
    return toNarrationRecord(project, mode, []);
  }

  async #synthesizeNarration(projectId: string, input?: {
    readonly sentenceIds?: readonly string[];
    readonly speechRate?: number;
  }): Promise<ProductionNarrationRecord> {
    const project = await this.#required(projectId);
    this.#requireIdle(project);
    const storyboard = project.storyboard;
    if (!storyboard) throw productionArtifactError("请先生成分镜脚本");
    if (!inspectScriptStoryboardReadiness({ storyboard }).ok) throw productionArtifactError("分镜脚本还没有可配音的句子");
    const speechRate = input?.speechRate ?? 1;
    if (!Number.isFinite(speechRate) || speechRate < 0.75 || speechRate > 1.25) {
      throw productionArtifactError("语速必须在0.75到1.25之间");
    }
    const byId = new Map(storyboard.sentences.map((sentence) => [sentence.id, sentence]));
    const requested = input?.sentenceIds;
    if (requested !== undefined) {
      if (requested.length === 0) throw productionArtifactError("请选择要配音的句子");
      if (new Set(requested).size !== requested.length) throw productionArtifactError("要配音的句子不能重复");
      if (requested.some((id) => !byId.has(id))) throw productionArtifactError("指定的句子不在分镜脚本中");
    }
    const paired = pairedNarration(project);
    const targets = requested !== undefined
      ? requested.map((id) => byId.get(id)!)
      : storyboard.sentences.filter((sentence) => !paired.has(sentence.id));
    const narration = project.mode === "montage" ? await this.#options.getNarrationMode() : "system";
    if (targets.length === 0) return this.#narrationSnapshot(project, narration, []);

    const connection = (await this.#options.getNarrationConnection?.()) ?? null;
    const transcription = connection?.baseUrl && connection.asrModel
      ? { baseUrl: connection.baseUrl, model: connection.asrModel }
      : undefined;
    if (narration === "provider" && !connection?.ttsTransport) {
      throw new TaskError({ code: "TTS_UNAVAILABLE", message: "云端配音连接不完整，请在 AI 连接中配置 TTS 后重试", action: "retry" });
    }

    let strategy: TtsTimingAlignmentSource = "whisper_fallback";
    let instructions: readonly NarrationSentenceTimingInstruction[];
    if (project.mode === "avatar" || narration === "provider") {
      // 云端配音与口播切片走 ai 层的指令计划：策略按 Provider 能力分派，含文本预清洗。
      const timingPlan = buildNarrationTimingInstructionPlan({
        mode: project.mode,
        sentences: targets,
        ...(project.mode === "montage"
          ? { connection: { ttsTransport: connection?.ttsTransport ?? "", ttsModel: connection?.ttsModel ?? null, ttsVoice: connection?.ttsVoice ?? null } }
          : {}),
      });
      if (!timingPlan.ok) throw new TaskError({ code: "TTS_UNAVAILABLE", message: timingPlan.message, action: "retry" });
      strategy = timingPlan.value.sentences[0]?.strategy ?? "whisper_fallback";
      instructions = timingPlan.value.sentences;
    } else {
      // 系统语音没有云端连接可言：直接用同一套清洗助手构造指令；ASR 已配置时才请求转写。
      instructions = targets.map((sentence) => {
        const cleaning = cleanNarrationSpeechText(sentence.text);
        return { sentenceId: sentence.id, speechText: cleaning.speechText, strategy: "whisper_fallback" as const, needsTranscription: Boolean(transcription), replacements: cleaning.replacements };
      });
    }
    const nativeSentences: readonly NativeNarrationSentenceInstruction[] = instructions.map((instruction) => ({
      sentenceId: instruction.sentenceId,
      speechText: instruction.speechText,
      ...(instruction.needsTranscription && transcription ? { needsTranscription: true } : {}),
    }));
    const wantsTranscription = nativeSentences.some((sentence) => sentence.needsTranscription === true);

    const handle = await this.#options.native.addListener?.("productionProgress", (event) => {
      if (event.projectId !== projectId) return;
      const mapped = narrationProgressEvent(event);
      if (mapped) void this.#emit(projectId, mapped);
    });
    let outcomes: readonly NativeNarrationSentenceOutcome[];
    try {
      outcomes = (await this.#options.native.synthesizeNarration({
        projectId,
        mode: project.mode,
        narration,
        speechRate,
        ...(narration === "provider"
          ? { providerInstruction: { miMoInstruction: MIMO_CHAT_AUDIO_TTS_INSTRUCTION, stepFunInstruction: STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION } }
          : {}),
        sentences: nativeSentences,
        ...(wantsTranscription && transcription ? { transcriptionInstruction: transcription } : {}),
      })).sentences;
    } catch (error) {
      // 整次调用失败进入可解释终态；已就绪句子的音轨保持原样，重试只补缺失部分。
      const failure = productionTaskError(error, "逐句配音没有完成");
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(failure, { code: "TTS_SYNTHESIS_FAILED", message: "逐句配音没有完成", action: "retry" }) });
      throw failure;
    } finally {
      await handle?.remove();
    }

    const targetIds = new Set(targets.map((sentence) => sentence.id));
    const tracksBySentence = new Map((project.narrationTracks ?? []).map((track) => [track.sentenceId, track]));
    const assetsBySentence = new Map((project.narrationAssets ?? []).map((asset) => [asset.sentenceId, asset]));
    const instructionBySentence = new Map(instructions.map((instruction) => [instruction.sentenceId, instruction]));
    const failures: ProductionNarrationFailure[] = [];
    // 重合成改变了既有计划依赖的句子 → 计划与成片立即过期，宁可回退也不展示不匹配产物。
    const planSentenceIds = project.plan?.schemaVersion === "production-plan.v4"
      ? new Set(project.plan.shots.map((shot) => shot.sentenceId)) : null;
    const changedPlanSentences = new Set<string>();
    let succeededCount = 0;
    for (const outcome of outcomes) {
      // native 回传了未请求的句子时忽略：它不属于本次调用承诺的范围。
      if (!targetIds.has(outcome.sentenceId)) continue;
      const sentence = byId.get(outcome.sentenceId);
      if (!sentence) continue;
      if (typeof outcome.durationMs !== "number" || !Number.isFinite(outcome.durationMs) || outcome.durationMs <= 0
        || typeof outcome.audioPath !== "string" || !outcome.audioPath.trim()) {
        failures.push({
          sentenceId: outcome.sentenceId,
          issue: issueFromAppError(productionTaskError({ code: outcome.error ?? "ERR_TTS_SYNTHESIS_FAILED" }, "这句配音没有生成成功")),
        });
        continue;
      }
      const words = this.#wordsFromOutcome(outcome, sentence, instructionBySentence.get(outcome.sentenceId), strategy);
      tracksBySentence.set(outcome.sentenceId, {
        sentenceId: outcome.sentenceId,
        durationMs: outcome.durationMs,
        alignmentSource: strategy,
        ...(words ? { words } : {}),
      });
      assetsBySentence.set(outcome.sentenceId, { sentenceId: outcome.sentenceId, audioPath: outcome.audioPath });
      succeededCount += 1;
      if (planSentenceIds?.has(outcome.sentenceId)) changedPlanSentences.add(outcome.sentenceId);
    }

    const allFailed = succeededCount === 0 && failures.length > 0;
    const stale = changedPlanSentences.size > 0;
    const staleOutput = stale && Boolean(project.output);
    const { plan: _previousPlan, output: _previousOutput, issue: _previousIssue, ...narrationBase } = project;
    void _previousPlan; void _previousOutput; void _previousIssue;
    const saved = await this.#persist({
      // 非 stale 时把计划与成片放回；stale 时它们已被判定过期，不再展示。
      ...stale ? narrationBase : project,
      status: allFailed ? "failed" : "draft",
      narrationTracks: [...tracksBySentence.values()],
      narrationAssets: [...assetsBySentence.values()],
      ...(allFailed ? { issue: failures[0]?.issue } : {}),
    });
    // The record committed first, so deleting the stale output afterwards can at worst leave an
    // orphan MP4 the new record no longer references - never a record pointing at a deleted file.
    if (staleOutput) {
      await this.#options.files.deleteProductionFile({ projectId, relativePath: "output.mp4" }).catch(() => undefined);
    }
    return this.#narrationSnapshot(saved, narration, failures);
  }

  /**
   * 词级时间戳来源：`native` 策略的词与朗读文本同源，直接映射；`whisper_fallback` 走
   * ai 层对齐纯函数反查原文词。对齐失败或没有转写时返回 undefined——本句只有句级实测
   * 时长，字幕边界按既有规则退回比例估算，不编造词级精度。
   */
  #wordsFromOutcome(
    outcome: NativeNarrationSentenceOutcome,
    sentence: ScriptSentence,
    instruction: NarrationSentenceTimingInstruction | undefined,
    strategy: TtsTimingAlignmentSource,
  ): readonly SubtitleCueWordTiming[] | undefined {
    const transcribed = outcome.transcribedWords;
    if (!transcribed || transcribed.length === 0) return undefined;
    if (strategy === "native") {
      const words = transcribed
        .filter((word) => typeof word?.word === "string" && word.word.trim())
        .map((word) => ({ text: word.word, startMs: word.startMs, endMs: word.endMs }));
      return words.length > 0 ? words : undefined;
    }
    const alignment = alignNarrationWordsWithWhisper({
      sentenceId: sentence.id,
      text: sentence.text,
      replacements: instruction?.replacements ?? [],
      transcribedWords: transcribed,
      durationMs: outcome.durationMs!,
    });
    return alignment.ok ? alignment.value.track.words ?? undefined : undefined;
  }

  async #narrationSnapshot(
    project: PersistedProject,
    mode: "system" | "provider",
    failures: readonly ProductionNarrationFailure[],
  ): Promise<ProductionNarrationRecord> {
    const record = toNarrationRecord(project, mode, failures);
    if (!record) throw productionArtifactError("分镜脚本缺失，无法读取配音状态");
    return record;
  }

  /**
   * 把「分镜脚本 + 逐句实测音轨」组装成 v4 计划。毫秒全部来自实测，本地推导；软违规
   * （单镜超 20 秒、总时长出 15–60 秒）结构化返回给界面提示，从不静默吞掉也不阻塞。
   */
  async composeMeasuredPlan(projectId: string, input?: { readonly subtitleTemplateId?: string }): Promise<MeasuredPlanComposeResult> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#composeMeasuredPlan(projectId, input),
    ));
  }

  async #composeMeasuredPlan(projectId: string, input?: { readonly subtitleTemplateId?: string }): Promise<MeasuredPlanComposeResult> {
    const project = await this.#required(projectId);
    this.#requireIdle(project);
    const storyboard = project.storyboard;
    if (!storyboard) throw productionArtifactError("请先生成分镜脚本");
    const paired = pairedNarration(project);
    const readiness = inspectNarrationReadiness({ storyboard, tracks: [...paired.values()].map((entry) => entry.track) });
    if (!readiness.ok) {
      throw productionArtifactError(readiness.reason === "need-storyboard-sentences" ? "分镜脚本还没有可配音的句子" : "还有句子没有完成配音，请补齐后再组装计划");
    }

    // 镜头草稿：句子顺序即镜头顺序；绑定沿用脚本建议，缺失或已失效的绑定按画面素材轮换补齐。
    const visualPool = project.assets
      .filter((asset) => isMontageVisualAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind }))
      .map((asset) => asset.id);
    const avatarAsset = project.assets.find((asset) => isAvatarVideoAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind }));
    if (project.mode === "avatar" && !avatarAsset) throw productionArtifactError("请先上传数字人视频", "select_media");
    if (project.mode === "montage" && visualPool.length === 0) throw productionArtifactError("请先导入图片或视频素材", "select_media");
    const visualIds = new Set(visualPool);
    let unboundCursor = 0;
    const drafts = storyboard.sentences.map((sentence) => {
      const suggested = sentence.assetId !== undefined && visualIds.has(sentence.assetId) ? sentence.assetId : undefined;
      const assetId = suggested ?? (project.mode === "avatar" ? avatarAsset!.id : visualPool[unboundCursor++ % visualPool.length]!);
      return {
        sentenceId: sentence.id,
        assetId,
        narration: sentence.text,
        caption: [...sentence.text.replace(/\s+/gu, "")].slice(0, 20).join(""),
        fit: "cover" as const,
        ...(sentence.emphasisWords && sentence.emphasisWords.length > 0 ? { emphasisWords: sentence.emphasisWords } : {}),
      };
    });

    // 数字人单视频：画面时长由确定性规划器按实测配音烘焙——源视频从 0 顺序消费、到尾回绕，
    // 每镜拿到一串显式窗口；10 秒素材配 30 秒配音也能规划成功，只有 <2 秒的源才硬拒绝。
    // 软违规（源偏短循环频繁）沿用实测时长的软违规通道，提示不阻塞。
    let shotDrafts = drafts;
    const avatarSoftViolations: MeasuredDurationViolation[] = [];
    if (project.mode === "avatar") {
      const sourceDurationMs = avatarAsset!.durationSeconds !== undefined
        ? Math.round(avatarAsset!.durationSeconds * 1_000)
        : Number.NaN;
      const windowPlan = planAvatarSourceWindows({
        sourceDurationMs,
        shotDurationMs: drafts.map((draft) => Math.round(paired.get(draft.sentenceId)!.track.durationMs)),
      });
      if (!windowPlan.ok) {
        const reason = windowPlan.hardViolations[0]?.reason;
        if (reason === "avatar-source-too-short") {
          throw productionArtifactError("数字人视频不足2秒，画面无法自然循环，请更换更长的出镜视频", "select_media");
        }
        if (reason === "avatar-source-duration-invalid") {
          throw productionArtifactError("无法读取数字人视频的时长，请重新选择完整视频", "select_media");
        }
        throw productionArtifactError("数字人画面规划失败，请重试");
      }
      shotDrafts = drafts.map((draft, index) => ({ ...draft, sourceWindows: windowPlan.shots[index]!.windows }));
      avatarSoftViolations.push(...windowPlan.softViolations);
    }

    // 分镜句的贴纸建议映射为装饰意图：落点窗口由字幕 cue 决定，这里只携带选择。
    // AI 是逐句建议、不知道全片上限；超过渲染契约上限的后续建议确定性丢弃，而不是让
    // 整次组装在最后一步被 schema 拒绝（真机复现：8 句里 7 句带贴纸建议导致合成失败）。
    const decorations: DecorationIntent[] = [];
    for (const [index, sentence] of storyboard.sentences.entries()) {
      if (!sentence.stickerId) continue;
      if (decorations.length >= MAX_DECORATIONS_PER_PLAN) break;
      decorations.push({
        kind: "sticker",
        assetRef: sentence.stickerId,
        text: null,
        shotOrder: index + 1,
        anchor: "above_caption",
        scale: 1,
        animation: "fade",
      });
    }

    const title = [...(storyboard.purpose?.trim() || project.brief.trim())].slice(0, 80).join("");
    const primaryText = project.headlineText ?? [...project.brief.replace(/\s+/gu, "")].slice(0, 24).join("");
    const describedAssetIds = project.assets.filter((asset) => asset.insight?.usable === true).map((asset) => asset.id);
    const plan = withMeasuredSubtitleTimeline({
      // v4 计划的 source 契约是「id 或 null」：一句话成片没有参考拆解时必须落 null，
      // 空串既过不了 schema，也会让下游误以为存在一条可回溯的来源任务。
      source: { analysisTaskId: project.analysisTaskId || null },
      title,
      audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
      textOverlay: { primaryText, secondaryText: null, preset: project.textPreset },
      shots: shotDrafts,
      tracks: drafts.map((draft) => paired.get(draft.sentenceId)!.track),
      ...(input?.subtitleTemplateId ? { requestedTemplateId: input.subtitleTemplateId } : {}),
      ...(project.mode === "montage" && describedAssetIds.length > 0
        ? { grounding: { visual: "asset_insight" as const, describedAssetIds } }
        : {}),
      ...(decorations.length > 0 ? { decorations } : {}),
      invalid: (cause) => new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "实测制作计划组装失败", action: "retry", cause }),
    });
    const referenceText = originalSourceText(await this.#options.tasks.getDetail(project.analysisTaskId).catch(() => undefined));
    const softViolations = validateMeasuredProductionPlan(plan, {
      analysisTaskId: project.analysisTaskId || null,
      mode: project.mode,
      textPreset: project.textPreset,
      ...(project.headlineText ? { headlineText: project.headlineText } : {}),
      ...(input?.subtitleTemplateId ? { subtitleTemplateId: input.subtitleTemplateId } : {}),
      allowedDecorationIds: [...DECORATION_IDS],
      assets: await this.#planningAssets(project),
      ...(referenceText ? { originalSourceText: referenceText } : {}),
    });

    const { plan: _oldPlan, output: _oldOutput, issue: _oldIssue, ...composeBase } = project;
    void _oldPlan; void _oldOutput; void _oldIssue;
    // Commit the record before touching files (same contract as updatePlan): a failed persist
    // keeps the old plan/output pair intact, and cleanup failures only leave orphans.
    const saved = await this.#persist({ ...composeBase, status: "ready", plan }, { emit: false });
    if (project.output) {
      // The rendered MP4 no longer matches the measured plan. Leaving it would show the new plan
      // as already exported; on delete failure the record rolls back to the pre-compose state.
      try {
        await this.#options.files.deleteProductionFile({ projectId, relativePath: "output.mp4" });
      } catch (error) {
        await this.#save(project).catch(() => undefined);
        await this.#emit(projectId, { type: "state", project: this.#project(project) }).catch(() => undefined);
        throw storageTaskError(error, "作废旧成片失败，制作计划已恢复到组装前的状态。");
      }
    }
    // Derived sidecar, written last: project.json is the authority the UI reads.
    await this.#options.files.writeProductionText({ projectId, relativePath: PLAN_PATH, value: JSON.stringify(plan), replace: true });
    const value = this.#project(saved);
    await this.#emit(projectId, { type: "state", project: value });
    return {
      schemaVersion: PRODUCTION_MEASURED_PLAN_RESULT_VERSION,
      project: value,
      softViolations: [...softViolations, ...avatarSoftViolations],
    };
  }

  /**
   * 一键全自动管线（v4 的默认推进方式，不是新增能力）：分镜脚本 → 逐句配音 → 组装实测
   * 计划 → 本机渲染成片，一次 `#exclusive` 互斥锁内顺序执行。各阶段沿用阶段方法自身的
   * 事件与持久化契约（script-progress 流式增量、narration-progress、render-progress、
   * state），界面在目标页面上按阶段生长，无需用户逐步点击；分步方法仍保留为编辑逃生口。
   *
   * 配音部分失败时诚实地停在配音阶段（组装要求全部句子就绪）：结果携带
   * `narrationFailures`，界面引导逐句补齐后重试，而不是假装管线走到了成片。
   */
  async runAutomaticPipeline(projectId: string, input?: {
    readonly brief?: string;
    readonly subtitleTemplateId?: string;
  }): Promise<AutomaticPipelineResult> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#runAutomaticPipeline(projectId, input),
    ));
  }

  async #runAutomaticPipeline(projectId: string, input?: {
    readonly brief?: string;
    readonly subtitleTemplateId?: string;
  }): Promise<AutomaticPipelineResult> {
    // 已有脚本且没有新需求时复用现有分镜：重试（如部分配音失败）从配音继续补齐，
    // 不悄悄重写用户可能已经确认过的文稿。
    const existing = await this.#required(projectId);
    try {
      if (!existing.storyboard || input?.brief !== undefined) {
        await this.#generateScript(projectId, input?.brief !== undefined ? { brief: input.brief } : undefined);
      }
      const narration = await this.#synthesizeNarration(projectId);
      if (narration.failures.length > 0) {
        const project = await this.#required(projectId);
        return {
          schemaVersion: PRODUCTION_AUTOMATIC_PIPELINE_RESULT_VERSION,
          project: this.#project(project),
          softViolations: [],
          narrationFailures: narration.failures,
        };
      }
      const composed = await this.#composeMeasuredPlan(
        projectId,
        input?.subtitleTemplateId !== undefined ? { subtitleTemplateId: input.subtitleTemplateId } : undefined,
      );
      // 软违规是一键路径的提示而非闸门：全自动语义下继续渲染，成片照常产出。
      await this.#render(projectId);
      const project = await this.#required(projectId);
      return {
        schemaVersion: PRODUCTION_AUTOMATIC_PIPELINE_RESULT_VERSION,
        project: this.#project(project),
        softViolations: composed.softViolations,
      };
    } catch (error) {
      // 脚本、配音与渲染阶段失败时各自已落盘 issue 并 rethrow；组装阶段没有失败持久化
      // 路径。一键失败必须把可行动错误写进 project.issue：向导跳走后界面在制作页仍能
      // 看到失败原因与重试入口，而不是一个既没有成片也没有解释的项目。
      const current = await this.#readPersisted(projectId).catch(() => undefined);
      if (current && current.status !== "failed") {
        const { plan: _plan, output: _output, issue: _issue, ...base } = current;
        void _plan; void _output; void _issue;
        await this.#persist({
          ...base,
          status: "failed",
          issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "一键制作没有完成", action: "retry" }),
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * v4 分镜脚本的逐句有界编辑。句子 id、顺序与句数不可变（那是「重新生成」的职责）；
   * 只允许改文案、素材绑定建议与贴纸建议。改文案会使该句配音（音轨与音频文件）作废；
   * 任何编辑都使旧计划与成片失效——计划由脚本派生，宁可回退也不展示不匹配的产物。
   */
  async updateStoryboard(projectId: string, input: {
    readonly expectedUpdatedAt: string;
    readonly sentences: readonly {
      readonly sentenceId: string;
      readonly text?: string;
      readonly assetId?: string | null;
      readonly stickerId?: string | null;
    }[];
  }): Promise<ProductionScriptRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      this.#requireIdle(project);
      const storyboard = project.storyboard;
      if (!storyboard) throw productionArtifactError("这个项目还没有分镜脚本");
      if (input.sentences.length === 0) throw productionArtifactError("请选择要修改的句子");

      const byId = new Map(storyboard.sentences.map((sentence) => [sentence.id, sentence]));
      const edits = new Map<string, (typeof input.sentences)[number]>();
      for (const edit of input.sentences) {
        if (!byId.has(edit.sentenceId)) throw productionArtifactError("要修改的句子不在分镜脚本中");
        if (edits.has(edit.sentenceId)) throw productionArtifactError("同一句不能重复修改");
        edits.set(edit.sentenceId, edit);
      }
      this.#requireExpectedVersion(project, input.expectedUpdatedAt);

      const visualIds = new Set(project.assets
        .filter((asset) => isMontageVisualAsset({ role: asset.role ?? defaultAssetRole(asset), kind: asset.kind }))
        .map((asset) => asset.id));
      const narrationChanged: string[] = [];
      const sentences = storyboard.sentences.map((sentence, index): ScriptSentence => {
        const edit = edits.get(sentence.id);
        if (!edit) return sentence;
        const text = edit.text !== undefined ? edit.text.trim() : sentence.text;
        if (!text) throw productionArtifactError(`第 ${index + 1} 句口播文案不能为空`);
        if ([...text].length > MAX_SCRIPT_SENTENCE_CHARACTERS) {
          throw productionArtifactError(`第 ${index + 1} 句口播文案超过 ${MAX_SCRIPT_SENTENCE_CHARACTERS} 字上限`);
        }
        if (edit.assetId !== undefined && edit.assetId !== null && !visualIds.has(edit.assetId)) {
          throw productionArtifactError("素材绑定必须指向项目内已导入的图片或视频");
        }
        if (edit.stickerId !== undefined && edit.stickerId !== null && !isDecorationId(edit.stickerId)) {
          throw productionArtifactError("贴纸建议不在内置装饰清单中");
        }
        const assetId = edit.assetId === undefined ? sentence.assetId : edit.assetId ?? undefined;
        const stickerId = edit.stickerId === undefined ? sentence.stickerId : edit.stickerId ?? undefined;
        const textChanged = edit.text !== undefined && text !== sentence.text;
        if (textChanged) narrationChanged.push(sentence.id);
        const { assetId: _oldAsset, stickerId: _oldSticker, ...rest } = sentence;
        void _oldAsset; void _oldSticker;
        return {
          ...rest,
          text,
          ...(assetId !== undefined ? { assetId } : {}),
          ...(stickerId !== undefined ? { stickerId } : {}),
          estimatedMs: textChanged ? estimateScriptSentenceMs(text) : sentence.estimatedMs,
        };
      });

      // 改了文案的句子：音轨记录移除；音频文件在记录落盘后删除（失败容忍，留孤儿随
      // 重新配音或删除项目收敛），persist 失败不会留下「记录还引用、文件已删掉」的半作废态。
      const invalidated = new Set(narrationChanged);
      const tracks = (project.narrationTracks ?? []).filter((track) => !invalidated.has(track.sentenceId));
      const assets = (project.narrationAssets ?? []).filter((asset) => !invalidated.has(asset.sentenceId));
      const invalidatedAudio = (project.narrationAssets ?? [])
        .filter((asset) => invalidated.has(asset.sentenceId))
        .map((asset) => asset.audioPath);
      // 计划与成片由脚本派生：脚本变了就整体作废，重新组装（本地推导）即可恢复。
      const { plan: _plan, output: _output, issue: _issue, ...base } = project;
      void _plan; void _output; void _issue;
      const saved = await this.#persist({
        ...base,
        status: "draft",
        storyboard: { ...storyboard, sentences },
        ...(tracks.length > 0 ? { narrationTracks: tracks } : {}),
        ...(assets.length > 0 ? { narrationAssets: assets } : {}),
      }, { emit: false });
      const obsoleteFiles = [...invalidatedAudio, ...(project.output ? ["output.mp4" as const] : [])];
      for (const relativePath of obsoleteFiles) {
        await this.#options.files.deleteProductionFile({ projectId, relativePath }).catch(() => undefined);
      }
      const record = toScriptRecord(saved);
      if (!record) throw productionArtifactError("分镜脚本没有保存成功");
      await this.#emit(projectId, { type: "state", project: this.#project(saved) });
      return record;
    });
  }

  async updatePlan(projectId: string, input: ProductionPlanUpdate): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      if (project.status === "planning" || project.status === "rendering") {
        throw productionArtifactError("制作项目正在处理中，请等结束后再微调");
      }
      if (project.storyboard) {
        // v4 项目的计划由实测配音组装，旧版逐镜秒数微调对它没有意义；阶段化编辑随后续
        // 任务落在分镜与配音阶段，而不是这里悄悄改坏实测时间轴。
        throw new TaskError({
          code: "PRODUCTION_PLAN_EDIT_INVALID",
          message: "分镜项目的计划由实测配音组装，请在阶段页调整文稿后重新组装",
          action: "edit_input",
        });
      }
      this.#requireExpectedVersion(project, input.expectedUpdatedAt);
      const plan = project.plan;
      if (!plan) throw productionArtifactError("请先生成可执行制作计划");

      // The headline lives on both the project and the plan overlay, so the constraint has to be
      // the edited value or validation would reject the plan for matching the new text.
      const headlineText = input.headlineText?.trim() || project.headlineText;
      const requestedTemplateId = input.subtitleTemplateId ?? requestedSubtitleTemplateId(plan);
      // Everything below the validated plan is a write, so validation has to finish first.
      const next = applyProductionPlanEdit({
        plan,
        edit: input,
        constraints: {
          ...await this.#editConstraints(project),
          ...(headlineText ? { headlineText } : {}),
          ...(requestedTemplateId === undefined ? {} : { subtitleTemplateId: requestedTemplateId }),
        },
      });
      const { output: _output, issue: _issue, ...base } = project;
      void _output; void _issue;

      // Validation and source-text lookup can await, so re-check the version immediately before
      // writing. This shrinks the window rather than closing it; see #118.
      this.#requireExpectedVersion(await this.#required(projectId), input.expectedUpdatedAt);
      // Announced only once the whole edit commits, so a rollback never leaves subscribers
      // believing the plan changed.
      const updated = await this.#persist({
        ...base,
        ...(headlineText ? { headlineText } : {}),
        status: "ready",
        plan: next,
      }, { emit: false });
      // The rendered MP4 no longer matches the plan. Leaving it would show the edit as already
      // exported; the project falls back to the same state as a plan that was never rendered.
      if (project.output) {
        try {
          await this.#options.files.deleteProductionFile({ projectId, relativePath: "output.mp4" });
        } catch (error) {
          await this.#save(project).catch(() => undefined);
          await this.#emit(projectId, { type: "state", project: this.#project(project) }).catch(() => undefined);
          throw storageTaskError(error, "作废旧成片失败，制作计划已恢复到微调前的状态。");
        }
      }
      // Derived sidecar, written last: until this point a failure only has to restore
      // `project.json`, which is the file everything actually reads.
      await this.#options.files.writeProductionText({ projectId, relativePath: PLAN_PATH, value: JSON.stringify(next), replace: true });
      const value = this.#project(updated);
      await this.#emit(projectId, { type: "state", project: value });
      return value;
    });
  }

  /** v4 阶段操作与微调/删除共用同一守卫：处理中的项目不接受并发变更。 */
  #requireIdle(project: PersistedProject): void {
    if (project.status !== "planning" && project.status !== "rendering") return;
    throw productionArtifactError("制作项目正在处理中，请等结束后再操作");
  }

  #requireExpectedVersion(project: PersistedProject, expectedUpdatedAt: string): void {
    if (project.updatedAt === expectedUpdatedAt) return;
    throw new TaskError({
      code: "PRODUCTION_PLAN_VERSION_STALE",
      message: "制作计划已被更新，请刷新后重新微调",
      action: "retry",
    });
  }

  /**
   * Looks at the material before planning, one asset at a time.
   *
   * Every failure mode ends the same way: the asset keeps no insight, the plan records that it was
   * matched blind, and the export stays available. Vision may be unconfigured, the frames may be
   * unreadable, the call may time out — none of that is a reason to withhold a video the renderer can
   * produce, and none of it may turn into a description nobody saw. Assets are described in sequence
   * because three concurrent frame decodes plus three uploads is how a phone runs out of memory.
   */
  async #describeAssets(project: PersistedProject, visualAssets: readonly PersistedAsset[]): Promise<PersistedProject> {
    const pending = visualAssets.filter((asset) => asset.insight === undefined);
    if (pending.length === 0 || !this.#options.native.insightFrames) return project;

    const described = new Map<string, PersistedInsight>();
    let provider: AiProvider | undefined;
    for (const asset of pending) {
      try {
        const { frames } = await this.#options.native.insightFrames({ projectId: project.projectId, assetId: asset.id });
        if (frames.length === 0) continue;
        provider ??= await this.#options.getProvider();
        const insight = await new AssetInsightFlow({ provider }).run({
          assetId: asset.id,
          kind: asset.kind === "video" ? "video" : "image",
          frames: frames.map((frame) => ({ uri: frame.uri, mimeType: frame.mimeType })),
        });
        described.set(asset.id, {
          description: insight.description,
          subject: insight.subject,
          tags: [...insight.tags],
          usable: insight.usable,
          unusableReason: insight.unusableReason,
          describedFrameCount: insight.describedFrameCount,
        });
      } catch {
        // Deliberately swallowed per asset. The absence of an insight is the honest record of this
        // failure, and it is already visible in the plan's grounding.
      }
    }
    if (described.size === 0) return project;
    return this.#persist({
      ...project,
      assets: project.assets.map((asset) => {
        const insight = described.get(asset.id);
        return insight ? { ...asset, insight } : asset;
      }),
      // Silent on purpose: the project is mid-planning and its status has not changed, so an event
      // here would only make subscribers re-render the same "planning" card.
    }, { emit: false });
  }

  /**
   * Planning assets with the shooting intent attached, so the plan can be checked against the list
   * the user actually filmed. If assets claim requirements the list can no longer be read, this
   * fails instead of quietly producing a plan in whatever order the model preferred.
   */
  async #planningAssets(project: PersistedProject): Promise<readonly ProductionPlanningAsset[]> {
    const base = project.assets.map(planningAsset);
    if (!project.assets.some((asset) => asset.requirementOrder !== undefined)) return base;
    const record = await this.#options.blueprints?.get(project.analysisTaskId).catch(() => undefined);
    const parsed = record?.status === "succeeded" && record.blueprint?.schemaVersion === "replica-blueprint.v1"
      ? replicaBlueprintResultSchema.safeParse(record.blueprint.document) : undefined;
    if (!parsed?.success) throw productionArtifactError("这些素材是按复刻清单拍的，但清单已经读不到了，请重新生成清单");
    const shots = new Map(parsed.data.shots.map((shot) => [shot.order, shot]));
    return base.map((planning, index) => {
      const order = project.assets[index]?.requirementOrder;
      if (order === undefined) return planning;
      const shot = shots.get(order);
      if (!shot) throw productionArtifactError(`复刻清单里已经没有第 ${order} 项，请重新生成清单后再制作`);
      return {
        ...planning,
        requirement: {
          order: shot.order,
          visualDescription: shot.visualDescription,
          contentHint: shot.material.contentHint,
          suggestedDurationSeconds: shot.material.suggestedDurationSeconds,
        },
      };
    });
  }

  async #editConstraints(project: PersistedProject): Promise<ProductionPlanConstraints> {
    // Generation refuses narration lifted verbatim from the reference copy. Without the same
    // source text an edit could do what generation had to refuse.
    const sourceText = originalSourceText(await this.#options.tasks.getDetail(project.analysisTaskId).catch(() => undefined));
    return {
      analysisTaskId: project.analysisTaskId,
      mode: project.mode,
      targetDurationSeconds: project.targetDurationSeconds,
      textPreset: project.textPreset,
      ...(sourceText ? { originalSourceText: sourceText } : {}),
      assets: await this.#planningAssets(project),
      // Same allow-list as generation: an edit must not be able to keep a sticker that generation
      // would have refused, nor drop one it accepted.
      allowedDecorationIds: [...DECORATION_IDS],
    };
  }

  async render(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-render", id: projectId, execution: "in-process" },
      () => this.#render(projectId),
    ));
  }

  async #render(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    const plan = project.plan;
    if (!plan) throw productionArtifactError("请先生成可执行制作计划");
    // v4（文稿先行）计划走「音频已就绪」路径：渲染器只消费已持久化的逐句配音，渲染期
    // 不再触发 TTS。缺任何一句都拒绝渲染——放行只会产出一半实测音频、一半现场合成
    // 语音的混合成片，那种产物无法解释也无法重试到一致。
    let narrationAssets: readonly { readonly sentenceId: string; readonly audioPath: string }[] | undefined;
    if (plan.schemaVersion === "production-plan.v4") {
      const paired = pairedNarration(project);
      if (plan.shots.some((shot) => !paired.has(shot.sentenceId))) {
        throw productionArtifactError("还有句子没有完成配音，请补齐后再合成");
      }
      narrationAssets = plan.shots.map((shot) => ({ sentenceId: shot.sentenceId, audioPath: paired.get(shot.sentenceId)!.audioPath }));
    }
    // A retry must not hide a previously verified MP4 while the replacement is
    // rendering. Native rendering writes and validates a temporary file first;
    // keep this metadata until a new output succeeds as well.
    const { issue: _issue, ...renderBase } = project;
    void _issue;
    project = await this.#persist({ ...renderBase, status: "rendering" });
    const handle = await this.#options.native.addListener?.("productionProgress", (event) => {
      if (event.projectId !== projectId) return;
      // 逐句配音等阶段事件没有整体百分比（bridge 契约允许省略 progress）；没有真实
      // progress 的原生事件不属于渲染进度，不编造数值发出去。
      if (typeof event.progress !== "number") return;
      const stage = typeof event.stage === "string" ? event.stage : "";
      void this.#emit(projectId, { type: "render-progress", projectId: event.projectId, progress: event.progress, stage });
    });
    try {
      const narration = project.mode === "montage" ? await this.#options.getNarrationMode() : "system";
      const output = await this.#options.native.render({
        projectId,
        planJson: JSON.stringify(plan),
        ...subtitleTemplatePayload(plan),
        // Render mode is a project fact, not a plan JSON field. v1/v2/v3 documents do not carry
        // it; Kotlin must not infer montage vs avatar from shots alone.
        mode: project.mode,
        narration,
        ...(narration === "provider"
          ? { miMoInstruction: MIMO_CHAT_AUDIO_TTS_INSTRUCTION, stepFunInstruction: STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION }
          : {}),
        ...(narrationAssets?.length ? { narrationAssets } : {}),
      });
      return this.#project(await this.#persist({ ...project, status: "succeeded", output }));
    } catch (error) {
      const failure = productionTaskError(error, "本地视频合成没有完成");
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(failure, { code: "MEDIA_MERGE_FAILED", message: "本地视频合成没有完成", action: "retry" }) });
      throw failure;
    } finally {
      await handle?.remove();
    }
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const { projectIds } = await this.#options.files.listProductionIds();
    const unfinished: RuntimeUnfinishedWork[] = [];
    for (const projectId of projectIds) {
      const project = await this.#readPersisted(projectId);
      if (project?.status === "planning") {
        unfinished.push(persistedRuntimeWork("production-plan", projectId));
      } else if (project?.status === "rendering") {
        unfinished.push(persistedRuntimeWork("production-render", projectId));
      }
    }
    return unfinished;
  }

  async recoverInterruptedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const unfinished = await this.inspectUnfinishedWork();
    const recovered: RuntimeUnfinishedWork[] = [];
    for (const work of unfinished) {
      if (await this.#recoverProject(work.id)) recovered.push(work);
    }
    return recovered;
  }

  async removeAsset(projectId: string, assetId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      this.#requireDeletable(project);
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw productionArtifactError("未找到要删除的制作素材", "select_media");
      const { plan: _plan, output: _output, issue: _issue, ...base } = project;
      void _plan; void _output; void _issue;
      const next = await this.#persist({ ...base, assets: project.assets.filter((item) => item.id !== assetId), status: "draft" });
      try {
        await this.#options.files.deleteProductionFile({ projectId, relativePath: assetPath(asset) });
      } catch (error) {
        await this.#save(project).catch(() => undefined);
        await this.#emit(projectId, { type: "state", project: this.#project(project) }).catch(() => undefined);
        throw storageTaskError(error, "删除素材文件失败，制作项目已恢复到删除前的状态。");
      }
      if (project.output) {
        await this.#options.files.deleteProductionFile({ projectId, relativePath: "output.mp4" });
      }
      return this.#project(next);
    });
  }

  async removeOutput(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      this.#requireDeletable(project);
      if (!project.output) throw productionArtifactError("当前制作项目没有可删除的成片");
      const { output: _output, issue: _issue, ...base } = project;
      void _output; void _issue;
      const next = await this.#persist({ ...base, status: project.plan ? "ready" : "draft" });
      try {
        await this.#options.files.deleteProductionFile({ projectId, relativePath: "output.mp4" });
      } catch (error) {
        await this.#save(project).catch(() => undefined);
        await this.#emit(projectId, { type: "state", project: this.#project(project) }).catch(() => undefined);
        throw storageTaskError(error, "删除成片文件失败，制作项目已恢复到删除前的状态。");
      }
      return this.#project(next);
    });
  }

  async delete(projectId: string): Promise<void> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      this.#requireDeletable(project);
      await this.#options.files.deleteProduction({ projectId });
      this.#listeners.delete(projectId);
    });
  }

  // 双签名：既有调用方按 core 契约订阅 `ProductionEvent`；v4 调用方（阶段页）订阅
  // `StandaloneProductionEvent` 才能收到逐句配音进度。窄监听器收到扩展事件时只是
  // 不认识 `type` 而忽略，运行时安全，故断言后统一存储。
  subscribe(projectId: string, listener: (event: StandaloneProductionEvent) => void | Promise<void>): () => void;
  subscribe(projectId: string, listener: (event: ProductionEvent) => void | Promise<void>): () => void;
  subscribe(projectId: string, listener: ((event: StandaloneProductionEvent) => void | Promise<void>) | ((event: ProductionEvent) => void | Promise<void>)) {
    const listeners = this.#listeners.get(projectId) ?? new Set<(event: StandaloneProductionEvent) => void | Promise<void>>();
    listeners.add(listener as (event: StandaloneProductionEvent) => void | Promise<void>);
    this.#listeners.set(projectId, listeners);
    return () => { listeners.delete(listener as (event: StandaloneProductionEvent) => void | Promise<void>); if (listeners.size === 0) this.#listeners.delete(projectId); };
  }

  async #track<T>(operation: RuntimeOperationIdentity, run: () => Promise<T>): Promise<T> {
    return this.#options.operations ? this.#options.operations.track(operation, run) : run();
  }

  async #readPersisted(projectId: string): Promise<PersistedProject | undefined> {
    const response = await this.#options.files.readProductionText({ projectId, relativePath: PROJECT_PATH });
    const project = response.value ? parseProject(response.value, projectId) : undefined;
    if (!project) return undefined;
    if (project.issue?.code !== "PRODUCTION_PLAN_UNREADABLE" || this.#mutations.has(projectId)) return project;
    let diskHasPlan = false;
    try {
      diskHasPlan = Boolean((JSON.parse(response.value ?? "{}") as { plan?: unknown }).plan);
    } catch {
      diskHasPlan = false;
    }
    if (!diskHasPlan && project.status === "failed") return project;
    const operation = this.#persist(project);
    this.#mutations.set(projectId, operation);
    try {
      return await operation;
    } finally {
      if (this.#mutations.get(projectId) === operation) this.#mutations.delete(projectId);
    }
  }

  async #recoverProject(projectId: string): Promise<boolean> {
    const project = await this.#readPersisted(projectId);
    if (!project || (project.status !== "planning" && project.status !== "rendering")) return false;
    if (this.#mutations.has(projectId)) return false;
    const operation = this.#failInterrupted(projectId);
    this.#mutations.set(projectId, operation);
    try {
      return await operation;
    } finally {
      if (this.#mutations.get(projectId) === operation) this.#mutations.delete(projectId);
    }
  }

  async #failInterrupted(projectId: string): Promise<boolean> {
    const project = await this.#required(projectId);
    if (project.status !== "planning" && project.status !== "rendering") return false;
    await this.#persist({ ...project, status: "failed", issue: runtimeInterruptedIssue() });
    return true;
  }

  async #required(projectId: string): Promise<PersistedProject> {
    const project = await this.#readPersisted(projectId);
    if (!project) throw productionArtifactError("制作项目不存在或已损坏");
    return project;
  }

  #requireDeletable(project: PersistedProject): void {
    if (project.status === "planning" || project.status === "rendering") {
      throw productionArtifactError("制作项目正在处理中，暂时不能删除");
    }
  }

  async #exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#mutations.has(projectId)) throw productionArtifactError("制作项目正在处理另一项操作，请稍后再试");
    const active = operation();
    this.#mutations.set(projectId, active);
    try {
      return await active;
    } finally {
      if (this.#mutations.get(projectId) === active) this.#mutations.delete(projectId);
    }
  }

  async #persist(project: PersistedProject, options?: { readonly emit?: boolean }): Promise<PersistedProject> {
    const updated = { ...project, updatedAt: this.#nextUpdatedAt(project.updatedAt) };
    await this.#save(updated);
    if (options?.emit === false) return updated;
    const value = this.#project(updated);
    await this.#emit(project.projectId, { type: "state", project: value });
    return updated;
  }

  /**
   * `updatedAt` doubles as the optimistic version token, so two writes inside the same clock tick
   * must not share one: a screen holding the older token would otherwise be accepted twice.
   */
  #nextUpdatedAt(previous: string): string {
    const now = (this.#options.now ?? (() => new Date()))().getTime();
    const last = Date.parse(previous);
    return new Date(Number.isFinite(last) && now <= last ? last + 1 : now).toISOString();
  }

  async #save(project: PersistedProject): Promise<void> {
    await this.#options.files.writeProductionText({ projectId: project.projectId, relativePath: PROJECT_PATH, value: JSON.stringify(project), replace: true });
  }

  #project(project: PersistedProject): ProductionProjectRecord {
    return toProductionProjectRecord(project, this.#options.toDisplayUri);
  }

  async #emit(projectId: string, event: StandaloneProductionEvent): Promise<void> {
    await Promise.allSettled([...(this.#listeners.get(projectId) ?? [])].map(async (listener) => { await listener(event); }));
  }
}
