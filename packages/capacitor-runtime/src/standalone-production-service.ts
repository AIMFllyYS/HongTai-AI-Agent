import { applyProductionPlanEdit, AssetInsightFlow, contentAnalysisResultSchema, createAvatarCaptionPlan, MIMO_CHAT_AUDIO_TTS_INSTRUCTION, ProductionPlanningFlow, replicaBlueprintResultSchema, requestedSubtitleTemplateId, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION, type AiProvider, type ProductionPlanConstraints, type ProductionPlanningAsset } from "@hongtai/ai";
import {
  createRuntimeId,
  DECORATION_IDS,
  inspectProductionPlanReadiness,
  isAvatarVideoAsset,
  isMontageVisualAsset,
  issueFromAppError,
  MAX_PRODUCTION_DURATION_SECONDS,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  PRODUCTION_TEXT_PRESET_VALUES,
  TaskError,
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
  TaskService,
} from "@hongtai/core";

import { persistedRuntimeWork, runtimeInterruptedIssue } from "./runtime-interruption.js";
import type { RuntimeOperationIdentity, RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import type { NativeProductionAsset, StandaloneProductionRuntimePlugin } from "./standalone-bridge.js";
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
  readonly #listeners = new Map<string, Set<(event: ProductionEvent) => void | Promise<void>>>();
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
    if (mode === "avatar" && !avatarScript) throw productionArtifactError("请填写与数字人口播视频一致的口播稿");
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
      ...(mode === "avatar" ? { avatarScript } : {}),
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

  async updatePlan(projectId: string, input: ProductionPlanUpdate): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      if (project.status === "planning" || project.status === "rendering") {
        throw productionArtifactError("制作项目正在处理中，请等结束后再微调");
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
    // A retry must not hide a previously verified MP4 while the replacement is
    // rendering. Native rendering writes and validates a temporary file first;
    // keep this metadata until a new output succeeds as well.
    const { issue: _issue, ...renderBase } = project;
    void _issue;
    project = await this.#persist({ ...renderBase, status: "rendering" });
    const handle = await this.#options.native.addListener?.("productionProgress", (event) => {
      if (event.projectId !== projectId) return;
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

  subscribe(projectId: string, listener: (event: ProductionEvent) => void | Promise<void>) {
    const listeners = this.#listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(projectId, listeners);
    return () => { listeners.delete(listener); if (listeners.size === 0) this.#listeners.delete(projectId); };
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

  async #emit(projectId: string, event: ProductionEvent): Promise<void> {
    await Promise.allSettled([...(this.#listeners.get(projectId) ?? [])].map(async (listener) => { await listener(event); }));
  }
}
