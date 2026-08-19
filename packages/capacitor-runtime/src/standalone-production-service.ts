import { applyProductionPlanEdit, AssetInsightFlow, contentAnalysisResultSchema, createAvatarCaptionPlan, MIMO_CHAT_AUDIO_TTS_INSTRUCTION, ProductionPlanningFlow, productionPlanResultSchema, replicaBlueprintResultSchema, requestedSubtitleTemplateId, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION, type AiProvider, type ProductionPlanConstraints, type ProductionPlanningAsset, type ProductionPlanResult } from "@hongtai/ai";
import {
  createRuntimeId,
  DECORATION_IDS,
  issueFromAppError,
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  subtitleTemplateById,
  TaskError,
} from "@hongtai/core";
import type {
  AnalysisService,
  JsonObject,
  ProductionAsset,
  ProductionAssetRecovery,
  ProductionAssetRole,
  ProductionEvent,
  ProductionMode,
  ProductionPlanUpdate,
  ProductionProjectRecord,
  ProductionService,
  ProductionTextPreset,
  ReplicaService,
  RuntimeUnfinishedWork,
  TaskIssue,
  TaskService,
} from "@hongtai/core";

import { persistedRuntimeWork, runtimeInterruptedIssue } from "./runtime-interruption.js";
import type { RuntimeOperationIdentity, RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import type { NativeProductionAsset, NativeProductionResult, StandaloneProductionRuntimePlugin } from "./standalone-bridge.js";

const PROJECT_PATH = "project.json";
const PLAN_PATH = "plan.json";

interface ProductionFilesPort {
  ensureProduction(options: { readonly projectId: string }): Promise<void>;
  writeProductionText(options: { readonly projectId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }): Promise<void>;
  readProductionText(options: { readonly projectId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listProductionIds(): Promise<{ readonly projectIds: readonly string[] }>;
  deleteProductionFile(options: { readonly projectId: string; readonly relativePath: string }): Promise<void>;
  deleteProduction(options: { readonly projectId: string }): Promise<void>;
}

/**
 * The blueprint requirement an asset was filmed for is an app-level decision, so it lives here
 * rather than on the native bridge DTO: the renderer has no use for it and must not be handed it.
 */
/**
 * What a vision model saw in this asset, kept next to the asset so a re-plan does not pay for the
 * same call twice. Only the descriptive half reaches the planner; `usable` and `unusableReason` are
 * a message for the user about reshooting.
 */
interface PersistedInsight {
  readonly description: string;
  readonly subject: string;
  readonly tags: readonly string[];
  readonly usable: boolean;
  readonly unusableReason: string | null;
  readonly describedFrameCount: number;
}

interface PersistedAsset extends NativeProductionAsset {
  readonly requirementOrder?: number;
  readonly insight?: PersistedInsight;
}

interface PersistedProject {
  readonly projectId: string;
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  readonly headlineText?: string;
  readonly textPreset: ProductionTextPreset;
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
  readonly status: ProductionProjectRecord["status"];
  readonly assets: readonly PersistedAsset[];
  /**
   * Which requirement the picker was opened for. Written before the external Activity starts,
   * because a WebView rebuild would otherwise return a file with nothing saying what it is for.
   */
  readonly pendingRequirementOrder?: number;
  readonly plan?: ProductionPlanResult;
  readonly output?: NativeProductionResult;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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

function taskError(message: string, action: "retry" | "select_media" = "retry"): TaskError {
  return new TaskError({ code: "TASK_ARTIFACT_MISSING", message, action });
}

function defaultAssetRole(value: Pick<NativeProductionAsset, "kind">): ProductionAssetRole {
  return value.kind === "audio" ? "music" : "visual";
}

/**
 * Projects an asset field by field for the planner, which also decides what reaches the provider:
 * the whole record would carry the private file URI, the stored byte count and the reshoot verdict
 * into the prompt, none of which a model needs to write a shot list.
 *
 * An unusable frame contributes no description at all. "We looked and saw nothing" is not grounding,
 * so the plan must not count that asset as described.
 */
function planningAsset(asset: PersistedAsset): ProductionPlanningAsset {
  const insight = asset.insight?.usable === true ? asset.insight : undefined;
  return {
    id: asset.id,
    kind: asset.kind,
    role: asset.role ?? defaultAssetRole(asset),
    mimeType: asset.mimeType,
    displayName: asset.displayName,
    ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
    ...(insight ? { insight: { description: insight.description, subject: insight.subject, tags: insight.tags } } : {}),
  };
}

/**
 * Hands the renderer the subtitle template the plan already committed to. The template is looked
 * up rather than re-resolved, because degrading a template that needs word-level timing is a
 * planning decision that must already be recorded in the plan the user approved.
 */
function subtitleTemplatePayload(plan: ProductionPlanResult): { readonly subtitleTemplateJson?: string } {
  if (plan.schemaVersion !== "production-plan.v3") return {};
  return { subtitleTemplateJson: JSON.stringify(subtitleTemplateById(plan.subtitle.templateId)) };
}

const TEXT_PRESETS = ["classic_top", "clean_card", "aqua_accent"] as const;

function originalSourceText(detail: Awaited<ReturnType<TaskService["getDetail"]>>): string | undefined {
  const direct = detail?.transcript?.text?.trim() || detail?.imageText?.text?.trim();
  const evidence = detail?.evidenceUnits.map((unit) => unit.text.trim()).filter(Boolean).join("\n");
  const value = (direct || evidence)?.replace(/\s+/gu, " ").trim();
  return value ? value.slice(0, 12_000) : undefined;
}

/** A requirement number that could not have come from a blueprint would bind an asset to nothing. */
function isRequirementOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SHOTS_PER_PRODUCTION;
}

function persistedAsset(value: PersistedAsset): PersistedAsset | undefined {
  const base = nativeAsset(value);
  if (!base) return undefined;
  const insight = persistedInsight(value.insight);
  if (value.requirementOrder === undefined) return insight ? { ...base, insight } : base;
  if (!isRequirementOrder(value.requirementOrder)) return undefined;
  return { ...base, requirementOrder: value.requirementOrder, ...(insight ? { insight } : {}) };
}

/**
 * A malformed insight is dropped rather than failing the read: it is a cached observation, and
 * losing it only costs one more vision call, whereas rejecting the record would make the project
 * unopenable over something that never affected the render.
 */
function persistedInsight(value: unknown): PersistedInsight | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PersistedInsight>;
  const { description, subject, usable, unusableReason, describedFrameCount } = candidate;
  if (typeof description !== "string" || !description.trim() || typeof subject !== "string" || !subject.trim()) return undefined;
  if (typeof usable !== "boolean" || !(typeof unusableReason === "string" || unusableReason === null)) return undefined;
  if (!Number.isInteger(describedFrameCount) || (describedFrameCount ?? 0) < 1) return undefined;
  const tags = Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
  return { description, subject, tags, usable, unusableReason, describedFrameCount: describedFrameCount as number };
}

function nativeAsset(value: NativeProductionAsset): NativeProductionAsset | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value.id) || !value.uri || !value.displayName || value.sizeBytes <= 0) return undefined;
  if (value.kind === "image" && !["image/jpeg", "image/png", "image/webp"].includes(value.mimeType)) return undefined;
  if (value.kind === "video" && value.mimeType !== "video/mp4") return undefined;
  if (value.kind === "audio" && !["audio/mpeg", "audio/mp4", "audio/wav"].includes(value.mimeType)) return undefined;
  const role = value.role ?? defaultAssetRole(value);
  if (!(["visual", "avatar", "music"] as const).includes(role)) return undefined;
  if (role === "avatar" && value.kind !== "video") return undefined;
  if (role === "music" && value.kind !== "audio") return undefined;
  if (role === "visual" && value.kind === "audio") return undefined;
  return { ...value, role };
}

function assetPath(asset: NativeProductionAsset): string {
  const extension = asset.mimeType === "image/jpeg" ? "jpg"
    : asset.mimeType === "image/png" ? "png"
      : asset.mimeType === "image/webp" ? "webp"
        : asset.mimeType === "video/mp4" ? "mp4"
          : asset.mimeType === "audio/mpeg" ? "mp3"
            : asset.mimeType === "audio/mp4" ? "m4a"
              : asset.mimeType === "audio/wav" ? "wav"
                : undefined;
  if (!extension) throw taskError("素材格式不支持安全删除");
  return `inputs/${asset.id}.${extension}`;
}

function parseProject(value: string, projectId: string): PersistedProject | undefined {
  try {
    const parsed = JSON.parse(value) as PersistedProject;
    if (parsed.projectId !== projectId || !parsed.analysisTaskId || !parsed.brief || !Array.isArray(parsed.assets)) return undefined;
    if (!Number.isFinite(parsed.targetDurationSeconds) || !["draft", "planning", "ready", "rendering", "succeeded", "failed"].includes(parsed.status)) return undefined;
    const mode = parsed.mode ?? "montage";
    if (mode !== "montage" && mode !== "avatar") return undefined;
    const avatarScript = parsed.avatarScript?.trim();
    if (parsed.avatarScript !== undefined && !avatarScript) return undefined;
    const headlineText = parsed.headlineText?.trim();
    if (parsed.headlineText !== undefined && (!headlineText || headlineText.length > 24)) return undefined;
    const textPreset = parsed.textPreset ?? "classic_top";
    if (!TEXT_PRESETS.includes(textPreset)) return undefined;
    const assets = parsed.assets.map(persistedAsset);
    if (assets.some((asset) => !asset)) return undefined;
    // Two assets claiming the same requirement would make "the clip for item 3" ambiguous.
    const bound = assets.map((asset) => asset?.requirementOrder).filter((order) => order !== undefined);
    if (new Set(bound).size !== bound.length) return undefined;
    if (parsed.pendingRequirementOrder !== undefined && !isRequirementOrder(parsed.pendingRequirementOrder)) return undefined;
    const plan = parsed.plan ? productionPlanResultSchema.safeParse(parsed.plan) : undefined;
    if (parsed.plan && !plan?.success) return undefined;
    return { ...parsed, mode, textPreset, ...(headlineText ? { headlineText } : {}), ...(avatarScript ? { avatarScript } : {}), assets: assets as readonly PersistedAsset[], ...(plan?.success ? { plan: plan.data } : {}) };
  } catch {
    return undefined;
  }
}

function nativeCode(error: unknown, remainingDepth = 3): string | undefined {
  if (remainingDepth <= 0 || typeof error !== "object" || error === null) return undefined;
  const value = error as Readonly<Record<string, unknown>>;
  if (typeof value.code === "string" && /^ERR_[A-Z0-9_]{2,116}$/u.test(value.code)) return value.code;
  return nativeCode(value.cause, remainingDepth - 1);
}

/** Keeps a private-file failure branchable by code instead of leaking a raw platform rejection. */
function storageTaskError(error: unknown, message: string): TaskError {
  return error instanceof TaskError ? error : new TaskError({ code: "STORAGE_WRITE_FAILED", message, action: "retry", cause: error });
}

function productionTaskError(error: unknown, fallbackMessage: string): TaskError {
  if (error instanceof TaskError) return error;
  const code = nativeCode(error);
  const mapped: Readonly<Record<string, Readonly<{
    code: TaskIssue["code"];
    message: string;
    action: "retry" | "select_media" | "free_storage" | "edit_input" | "none";
    retryable: boolean;
  }>>> = {
    // The renderer rejected the plan itself. Retrying the same plan can only fail again, so this
    // must not be dressed up as a transient render failure.
    ERR_INVALID_ARGUMENT: { code: "PRODUCTION_PLAN_EDIT_INVALID", message: "当前制作计划无法被本地渲染器执行，请调整镜头时长或文案后重新生成计划。", action: "edit_input", retryable: false },
    ERR_DECORATION_ASSET_MISSING: { code: "PRODUCTION_DECORATION_MISSING", message: "这台安装缺少成片要用的贴纸文件，改镜头或文案解决不了。请重新安装完整应用后再导出。", action: "none", retryable: false },
    ERR_MEDIA_SELECTION_CANCELLED: { code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择制作素材。", action: "select_media", retryable: false },
    ERR_MEDIA_SOURCE_MISSING: { code: "MEDIA_SOURCE_NOT_FOUND", message: "系统没有返回可读取的制作素材。", action: "select_media", retryable: false },
    ERR_MEDIA_READ_FAILED: { code: "MEDIA_READ_FAILED", message: "所选制作素材无法读取，请重新选择。", action: "select_media", retryable: false },
    ERR_ASSET_RECOVERY_FAILED: { code: "TASK_INTERRUPTED", message: "素材选择在应用重建后无法恢复，请重新选择。", action: "select_media", retryable: false },
    ERR_MEDIA_SOURCE_INVALID: { code: "MEDIA_SOURCE_INVALID", message: "素材不含可用于本地合成的媒体轨，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_MEDIA_PROBE_FAILED: { code: "MEDIA_PROBE_FAILED", message: "无法读取素材的媒体轨或时长，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_PRIVATE_FILE_IMPORT_FAILED: { code: "MEDIA_IMPORT_FAILED", message: "素材无法安全导入应用私有目录，请重新选择。", action: "select_media", retryable: false },
    ERR_TTS_UNAVAILABLE: { code: "TTS_UNAVAILABLE", message: "视频配音暂不可用。请检查 AI 连接中的 TTS 配置；未配置云端配音时，请确认手机已启用中文系统语音。", action: "retry", retryable: true },
    ERR_TTS_SYNTHESIS_FAILED: { code: "TTS_SYNTHESIS_FAILED", message: "视频旁白没有生成成功。请检查 AI 连接、网络或手机语音服务后重试。", action: "retry", retryable: true },
    ERR_MEDIA_RENDER_TIMEOUT: { code: "MEDIA_RENDER_TIMEOUT", message: "本地合成超时，已保留之前成功的成片。请减少时长或更换较小的素材后重试。", action: "retry", retryable: true },
    ERR_MEDIA_ENCODER_UNAVAILABLE: { code: "MEDIA_ENCODER_UNAVAILABLE", message: "这台手机未能用 H.264 编码器完成本次导出。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_MEDIA_DECODE_FAILED: { code: "MEDIA_DECODE_FAILED", message: "当前素材无法解码或缺少可用音轨，请重新选择可播放的素材。", action: "select_media", retryable: false },
    ERR_MEDIA_RENDER_PIPELINE_FAILED: { code: "MEDIA_RENDER_PIPELINE_FAILED", message: "本地画面处理没有完成。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_MEDIA_OUTPUT_INVALID: { code: "MEDIA_OUTPUT_INVALID", message: "导出文件未通过 H.264/AAC 成片校验，未覆盖之前成功的成片。请重试。", action: "retry", retryable: true },
    ERR_MEDIA_EXPORT_FAILED: { code: "MEDIA_EXPORT_FAILED", message: "本地视频导出没有完成。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_OUTPUT_FINALIZATION_FAILED: { code: "OUTPUT_FINALIZATION_FAILED", message: "新成片无法安全写入本地目录，之前成功的成片已保留。", action: "free_storage", retryable: true },
  };
  const selected = code ? mapped[code] : undefined;
  return new TaskError({
    code: selected?.code ?? "MEDIA_MERGE_FAILED",
    message: selected?.message ?? fallbackMessage,
    action: selected?.action ?? "retry",
    retryable: selected?.retryable ?? true,
    cause: error,
  });
}

export class StandaloneProductionService implements ProductionService {
  readonly #options: StandaloneProductionServiceOptions;
  readonly #listeners = new Map<string, Set<(event: ProductionEvent) => void | Promise<void>>>();
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(options: StandaloneProductionServiceOptions) { this.#options = options; }

  async create(input: { readonly analysisTaskId: string; readonly brief: string; readonly targetDurationSeconds: number; readonly mode?: ProductionMode; readonly avatarScript?: string; readonly headlineText?: string; readonly textPreset?: ProductionTextPreset }): Promise<ProductionProjectRecord> {
    const brief = input.brief.trim();
    if (!brief) throw taskError("请填写制作需求");
    if (input.targetDurationSeconds < MIN_PRODUCTION_DURATION_SECONDS || input.targetDurationSeconds > MAX_PRODUCTION_DURATION_SECONDS) {
      throw taskError("制作时长必须在15到60秒之间");
    }
    const mode = input.mode ?? "montage";
    const avatarScript = input.avatarScript?.trim();
    const headlineText = input.headlineText?.trim();
    const textPreset = input.textPreset ?? "classic_top";
    if (mode !== "montage" && mode !== "avatar") throw taskError("制作模式无效");
    if (mode === "avatar" && !avatarScript) throw taskError("请填写与数字人口播视频一致的口播稿");
    if (input.headlineText !== undefined && (!headlineText || headlineText.length > 24)) throw taskError("主文字必须在1到24个字符之间");
    if (!TEXT_PRESETS.includes(textPreset)) throw taskError("文字预设无效");
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
    const response = await this.#options.files.readProductionText({ projectId, relativePath: PROJECT_PATH });
    const project = response.value ? parseProject(response.value, projectId) : undefined;
    return project ? this.#project(project) : undefined;
  }

  async list(): Promise<readonly ProductionProjectRecord[]> {
    const { projectIds } = await this.#options.files.listProductionIds();
    const projects = await Promise.all(projectIds.map((id) => this.get(id)));
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
    const remaining = 12 - project.assets.length;
    if (remaining <= 0) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const selection = project.mode === "avatar" ? "avatar" as const : "visual" as const;
    if (selection === "avatar" && project.assets.some((asset) => (asset.role ?? defaultAssetRole(asset)) === "avatar")) {
      throw taskError("数字人口播模式只能上传一个数字人口播视频", "select_media");
    }
    if (requirementOrder === undefined) {
      // An earlier pick can have died with the WebView and left its marker behind — a cancelled or
      // failed external Activity never comes back to clear it. This import was not made for that
      // item, so the marker goes before the picker opens rather than silently marking whatever the
      // user adds here as the material for it. Together with the overwrite below, a marker can then
      // only ever describe the pick currently in flight.
      project = await this.#withoutPendingRequirement(project);
    } else {
      if (!isRequirementOrder(requirementOrder)) throw taskError("素材清单项编号无效", "select_media");
      if (project.assets.some((asset) => asset.requirementOrder === requirementOrder)) {
        throw taskError(`第 ${requirementOrder} 项已经有素材了，先移除再换一个`, "select_media");
      }
      // Recorded before the picker leaves the app, so a rebuilt WebView still knows what the
      // returned file was chosen for.
      project = await this.#persist({ ...project, pendingRequirementOrder: requirementOrder }, { emit: false });
    }
    let result;
    try {
      result = await this.#options.native.pickAssets({ projectId, maxItems: requirementOrder !== undefined || selection === "avatar" ? 1 : remaining, selection });
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
    if (project.pendingRequirementOrder === undefined) return project;
    const { pendingRequirementOrder: _pending, ...base } = project;
    void _pending;
    return this.#persist(base, { emit: false });
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
    const selection = project.mode === "avatar" ? "avatar" as const : "visual" as const;
    const imported = assets.map(nativeAsset).filter((asset): asset is NativeProductionAsset => Boolean(asset));
    if (imported.length === 0) {
      await this.#clearPendingRequirement(project.projectId).catch(() => undefined);
      throw taskError("没有导入可用的图片、视频或音频", "select_media");
    }
    if (selection === "avatar" && (imported.length !== 1 || imported[0]?.role !== "avatar" || imported[0].kind !== "video")) {
      await this.#clearPendingRequirement(project.projectId).catch(() => undefined);
      throw taskError("请选择一个包含口播原声的 MP4 数字人视频", "select_media");
    }
    // The picker can return more than the one item a requirement asked for; binding all of them
    // would claim the user filmed several things for the same list entry.
    const order = project.pendingRequirementOrder;
    const bound = order !== undefined && imported.length === 1
      ? [{ ...imported[0]!, requirementOrder: order }]
      : imported;
    const combined = new Map([...project.assets, ...bound].map((asset) => [asset.id, asset]));
    if (combined.size > 12) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const { plan: _plan, output: _output, issue: _issue, pendingRequirementOrder: _pending, ...base } = project;
    void _plan; void _output; void _issue; void _pending;
    return this.#project(await this.#persist({ ...base, assets: [...combined.values()], status: "draft" }));
  }

  async generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#generatePlan(projectId),
    ));
  }

  async #generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    const roleOf = (asset: NativeProductionAsset) => asset.role ?? defaultAssetRole(asset);
    const visualAssets = project.assets.filter((asset) => roleOf(asset) === "visual" && asset.kind !== "audio");
    const avatarAssets = project.assets.filter((asset) => roleOf(asset) === "avatar" && asset.kind === "video");
    if (project.mode === "montage" && visualAssets.length < MIN_MONTAGE_VISUAL_ASSETS) {
      throw taskError(`素材剪辑模式至少需要${MIN_MONTAGE_VISUAL_ASSETS}个图片或视频素材`, "select_media");
    }
    if (project.mode === "avatar" && (avatarAssets.length !== 1 || !project.avatarScript)) throw taskError("请上传一个数字人口播视频并填写对应口播稿", "select_media");
    if (project.mode === "avatar" && (avatarAssets[0]?.durationSeconds === undefined || avatarAssets[0].durationSeconds + 0.001 < project.targetDurationSeconds)) {
      throw new TaskError({
        code: "MEDIA_DURATION_EXCEEDED",
        message: `数字人口播视频时长不足 ${project.targetDurationSeconds} 秒，请选择更长的视频或缩短目标时长。`,
        action: "select_media",
      });
    }
    const { plan: _plan, output: _output, issue: _issue, ...planningBase } = project;
    void _plan; void _output; void _issue;
    project = await this.#persist({ ...planningBase, status: "planning" });
    try {
      const record = await this.#options.analysis.get(project.analysisTaskId);
      const parsed = record?.status === "succeeded" && record.result?.schemaVersion === "content-analysis.v1"
        ? contentAnalysisResultSchema.safeParse(record.result.document) : undefined;
      if (!parsed?.success) throw taskError("来源任务尚无可用的正式拆解结果");
      const sourceText = originalSourceText(await this.#options.tasks.getDetail(project.analysisTaskId));
      if (!sourceText) throw taskError("来源任务没有可用于参考的原始文稿");
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
        throw taskError("制作项目正在处理中，请等结束后再微调");
      }
      this.#requireExpectedVersion(project, input.expectedUpdatedAt);
      const plan = project.plan;
      if (!plan) throw taskError("请先生成可执行制作计划");

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
    if (!parsed?.success) throw taskError("这些素材是按复刻清单拍的，但清单已经读不到了，请重新生成清单");
    const shots = new Map(parsed.data.shots.map((shot) => [shot.order, shot]));
    return base.map((planning, index) => {
      const order = project.assets[index]?.requirementOrder;
      if (order === undefined) return planning;
      const shot = shots.get(order);
      if (!shot) throw taskError(`复刻清单里已经没有第 ${order} 项，请重新生成清单后再制作`);
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
    if (!plan) throw taskError("请先生成可执行制作计划");
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
      const project = await this.get(projectId);
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
      const project = await this.#required(work.id);
      if (project.status !== "planning" && project.status !== "rendering") continue;
      await this.#persist({ ...project, status: "failed", issue: runtimeInterruptedIssue() });
      recovered.push(work);
    }
    return recovered;
  }

  async removeAsset(projectId: string, assetId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, async () => {
      const project = await this.#required(projectId);
      this.#requireDeletable(project);
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw taskError("未找到要删除的制作素材", "select_media");
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
      if (!project.output) throw taskError("当前制作项目没有可删除的成片");
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

  async #required(projectId: string): Promise<PersistedProject> {
    const response = await this.#options.files.readProductionText({ projectId, relativePath: PROJECT_PATH });
    const project = response.value ? parseProject(response.value, projectId) : undefined;
    if (!project) throw taskError("制作项目不存在或已损坏");
    return project;
  }

  #requireDeletable(project: PersistedProject): void {
    if (project.status === "planning" || project.status === "rendering") {
      throw taskError("制作项目正在处理中，暂时不能删除");
    }
  }

  async #exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#mutations.has(projectId)) throw taskError("制作项目正在处理另一项操作，请稍后再试");
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
    const asset = (value: PersistedAsset): ProductionAsset => ({ id: value.id, role: value.role ?? defaultAssetRole(value), uri: this.#options.toDisplayUri(value.uri), kind: value.kind, origin: "imported", mimeType: value.mimeType, displayName: value.displayName, byteLength: value.sizeBytes, ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }), ...(value.requirementOrder === undefined ? {} : { requirementOrder: value.requirementOrder }), ...(value.insight?.usable === false && value.insight.unusableReason ? { reshootAdvice: value.insight.unusableReason } : {}) });
    return {
      projectId: project.projectId, analysisTaskId: project.analysisTaskId, brief: project.brief, mode: project.mode, textPreset: project.textPreset, ...(project.headlineText ? { headlineText: project.headlineText } : {}), ...(project.avatarScript ? { avatarScript: project.avatarScript } : {}), targetDurationSeconds: project.targetDurationSeconds,
      status: project.status, assets: project.assets.map(asset),
      ...(project.plan ? { plan: { schemaVersion: project.plan.schemaVersion, document: project.plan as unknown as JsonObject } } : {}),
      ...(project.output ? { output: { uri: this.#options.toDisplayUri(project.output.uri), kind: "video", origin: "imported", mimeType: project.output.mimeType, byteLength: project.output.sizeBytes, durationSeconds: project.output.durationSeconds, displayName: "本地成片.mp4" } } : {}),
      ...(project.issue ? { issue: project.issue } : {}), createdAt: project.createdAt, updatedAt: project.updatedAt,
    };
  }

  async #emit(projectId: string, event: ProductionEvent): Promise<void> {
    await Promise.allSettled([...(this.#listeners.get(projectId) ?? [])].map(async (listener) => { await listener(event); }));
  }
}
