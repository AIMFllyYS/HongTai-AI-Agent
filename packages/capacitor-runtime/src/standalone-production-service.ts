import { contentAnalysisResultSchema, createAvatarCaptionPlan, ProductionPlanningFlow, productionPlanResultSchema, type AiProvider, type ProductionPlanResultV1 } from "@hongtai/ai";
import { createRuntimeId, issueFromAppError, TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  JsonObject,
  ProductionAsset,
  ProductionAssetRole,
  ProductionEvent,
  ProductionMode,
  ProductionProjectRecord,
  ProductionService,
  RuntimeUnfinishedWork,
  TaskIssue,
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
}

interface PersistedProject {
  readonly projectId: string;
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
  readonly status: ProductionProjectRecord["status"];
  readonly assets: readonly NativeProductionAsset[];
  readonly plan?: ProductionPlanResultV1;
  readonly output?: NativeProductionResult;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StandaloneProductionServiceOptions {
  readonly files: ProductionFilesPort;
  readonly native: StandaloneProductionRuntimePlugin;
  readonly analysis: AnalysisService;
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

function nativeAsset(value: NativeProductionAsset): NativeProductionAsset | undefined {
  if (!value.id || !value.uri || !value.displayName || value.sizeBytes <= 0) return undefined;
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

function parseProject(value: string, projectId: string): PersistedProject | undefined {
  try {
    const parsed = JSON.parse(value) as PersistedProject;
    if (parsed.projectId !== projectId || !parsed.analysisTaskId || !parsed.brief || !Array.isArray(parsed.assets)) return undefined;
    if (!Number.isFinite(parsed.targetDurationSeconds) || !["draft", "planning", "ready", "rendering", "succeeded", "failed"].includes(parsed.status)) return undefined;
    const mode = parsed.mode ?? "montage";
    if (mode !== "montage" && mode !== "avatar") return undefined;
    const avatarScript = parsed.avatarScript?.trim();
    if (parsed.avatarScript !== undefined && !avatarScript) return undefined;
    const assets = parsed.assets.map(nativeAsset);
    if (assets.some((asset) => !asset)) return undefined;
    const plan = parsed.plan ? productionPlanResultSchema.safeParse(parsed.plan) : undefined;
    if (parsed.plan && !plan?.success) return undefined;
    return { ...parsed, mode, ...(avatarScript ? { avatarScript } : {}), assets: assets as readonly NativeProductionAsset[], ...(plan?.success ? { plan: plan.data } : {}) };
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

function productionTaskError(error: unknown, fallbackMessage: string): TaskError {
  if (error instanceof TaskError) return error;
  const code = nativeCode(error);
  const mapped: Readonly<Record<string, Readonly<{
    code: TaskIssue["code"];
    message: string;
    action: "retry" | "select_media" | "free_storage";
    retryable: boolean;
  }>>> = {
    ERR_MEDIA_SELECTION_CANCELLED: { code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择制作素材。", action: "select_media", retryable: false },
    ERR_MEDIA_SOURCE_INVALID: { code: "MEDIA_SOURCE_INVALID", message: "素材不含可用于本地合成的媒体轨，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_MEDIA_PROBE_FAILED: { code: "MEDIA_PROBE_FAILED", message: "无法读取素材的媒体轨或时长，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_PRIVATE_FILE_IMPORT_FAILED: { code: "MEDIA_IMPORT_FAILED", message: "素材无法安全导入应用私有目录，请重新选择。", action: "select_media", retryable: false },
    ERR_TTS_UNAVAILABLE: { code: "TTS_UNAVAILABLE", message: "视频配音暂不可用。请检查 AI 连接中的 TTS 配置；未配置云端配音时，请确认手机已启用中文系统语音。", action: "retry", retryable: true },
    ERR_TTS_SYNTHESIS_FAILED: { code: "TTS_SYNTHESIS_FAILED", message: "视频旁白没有生成成功。请检查 AI 连接、网络或手机语音服务后重试。", action: "retry", retryable: true },
    ERR_MEDIA_RENDER_TIMEOUT: { code: "MEDIA_RENDER_TIMEOUT", message: "本地合成超时，已保留之前成功的成片。请减少时长或更换较小的素材后重试。", action: "retry", retryable: true },
    ERR_MEDIA_EXPORT_FAILED: { code: "MEDIA_EXPORT_FAILED", message: "手机未能完成 H.264/AAC 视频导出。请更换兼容的 MP4 素材后重试。", action: "retry", retryable: true },
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

  constructor(options: StandaloneProductionServiceOptions) { this.#options = options; }

  async create(input: { readonly analysisTaskId: string; readonly brief: string; readonly targetDurationSeconds: number; readonly mode?: ProductionMode; readonly avatarScript?: string }): Promise<ProductionProjectRecord> {
    const brief = input.brief.trim();
    if (!brief) throw taskError("请填写制作需求");
    if (input.targetDurationSeconds < 15 || input.targetDurationSeconds > 60) throw taskError("制作时长必须在15到60秒之间");
    const mode = input.mode ?? "montage";
    const avatarScript = input.avatarScript?.trim();
    if (mode !== "montage" && mode !== "avatar") throw taskError("制作模式无效");
    if (mode === "avatar" && !avatarScript) throw taskError("请填写与数字人口播视频一致的口播稿");
    const projectId = this.#options.createProjectId?.() ?? createRuntimeId();
    const timestamp = (this.#options.now ?? (() => new Date()))().toISOString();
    const project: PersistedProject = {
      projectId,
      analysisTaskId: input.analysisTaskId,
      brief,
      mode,
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

  async importAssets(projectId: string): Promise<ProductionProjectRecord> {
    return this.#track(
      { kind: "transient-operation", id: `production-assets:${projectId}`, execution: "external-activity" },
      () => this.#importAssets(projectId),
    );
  }

  async #importAssets(projectId: string): Promise<ProductionProjectRecord> {
    const project = await this.#required(projectId);
    const remaining = 12 - project.assets.length;
    if (remaining <= 0) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const selection = project.mode === "avatar" ? "avatar" as const : "visual" as const;
    if (selection === "avatar" && project.assets.some((asset) => (asset.role ?? defaultAssetRole(asset)) === "avatar")) {
      throw taskError("数字人口播模式只能上传一个数字人口播视频", "select_media");
    }
    let result;
    try {
      result = await this.#options.native.pickAssets({ projectId, maxItems: selection === "avatar" ? 1 : remaining, selection });
    } catch (error) {
      throw productionTaskError(error, "素材没有导入成功");
    }
    const imported = result.assets.map(nativeAsset).filter((asset): asset is NativeProductionAsset => Boolean(asset));
    if (imported.length === 0) throw taskError("没有导入可用的图片、视频或音频", "select_media");
    if (selection === "avatar" && (imported.length !== 1 || imported[0]?.role !== "avatar" || imported[0].kind !== "video")) {
      throw taskError("请选择一个包含口播原声的 MP4 数字人视频", "select_media");
    }
    const combined = new Map([...project.assets, ...imported].map((asset) => [asset.id, asset]));
    if (combined.size > 12) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const { plan: _plan, output: _output, issue: _issue, ...base } = project;
    void _plan; void _output; void _issue;
    return this.#project(await this.#persist({ ...base, assets: [...combined.values()], status: "draft" }));
  }

  async generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    return this.#track(
      { kind: "production-plan", id: projectId, execution: "in-process" },
      () => this.#generatePlan(projectId),
    );
  }

  async #generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    const roleOf = (asset: NativeProductionAsset) => asset.role ?? defaultAssetRole(asset);
    const visualAssets = project.assets.filter((asset) => roleOf(asset) === "visual" && asset.kind !== "audio");
    const avatarAssets = project.assets.filter((asset) => roleOf(asset) === "avatar" && asset.kind === "video");
    if (project.mode === "montage" && visualAssets.length < 3) throw taskError("素材剪辑模式至少需要3个图片或视频素材", "select_media");
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
      const plan = project.mode === "avatar"
        ? createAvatarCaptionPlan({
          analysisTaskId: project.analysisTaskId,
          brief: project.brief,
          targetDurationSeconds: project.targetDurationSeconds,
          avatarScript: project.avatarScript ?? "",
          avatarAsset: avatarAssets[0]!,
        })
        : await new ProductionPlanningFlow({ provider: await this.#options.getProvider() }).run({
          analysisTaskId: project.analysisTaskId,
          brief: project.brief,
          mode: project.mode,
          targetDurationSeconds: project.targetDurationSeconds,
          analysis: parsed.data,
          assets: project.assets.map((asset) => ({ ...asset, role: roleOf(asset) })),
        });
      await this.#options.files.writeProductionText({ projectId, relativePath: PLAN_PATH, value: JSON.stringify(plan), replace: true });
      return this.#project(await this.#persist({ ...project, status: "ready", plan }));
    } catch (error) {
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "制作计划没有完成", action: "retry" }) });
      throw error;
    }
  }

  async render(projectId: string): Promise<ProductionProjectRecord> {
    return this.#track(
      { kind: "production-render", id: projectId, execution: "in-process" },
      () => this.#render(projectId),
    );
  }

  async #render(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    if (!project.plan) throw taskError("请先生成可执行制作计划");
    // A retry must not hide a previously verified MP4 while the replacement is
    // rendering. Native rendering writes and validates a temporary file first;
    // keep this metadata until a new output succeeds as well.
    const { issue: _issue, ...renderBase } = project;
    void _issue;
    project = await this.#persist({ ...renderBase, status: "rendering" });
    const handle = await this.#options.native.addListener?.("productionProgress", (event) => {
      if (event.projectId === projectId) void this.#emit(projectId, { type: "render-progress", ...event });
    });
    try {
      const narration = project.mode === "montage" ? await this.#options.getNarrationMode() : "system";
      const output = await this.#options.native.render({ projectId, planJson: JSON.stringify(project.plan), mode: project.mode, narration });
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

  async #persist(project: PersistedProject): Promise<PersistedProject> {
    const updated = { ...project, updatedAt: (this.#options.now ?? (() => new Date()))().toISOString() };
    await this.#save(updated);
    const value = this.#project(updated);
    await this.#emit(project.projectId, { type: "state", project: value });
    return updated;
  }

  async #save(project: PersistedProject): Promise<void> {
    await this.#options.files.writeProductionText({ projectId: project.projectId, relativePath: PROJECT_PATH, value: JSON.stringify(project), replace: true });
  }

  #project(project: PersistedProject): ProductionProjectRecord {
    const asset = (value: NativeProductionAsset): ProductionAsset => ({ id: value.id, role: value.role ?? defaultAssetRole(value), uri: this.#options.toDisplayUri(value.uri), kind: value.kind, origin: "imported", mimeType: value.mimeType, displayName: value.displayName, byteLength: value.sizeBytes, ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }) });
    return {
      projectId: project.projectId, analysisTaskId: project.analysisTaskId, brief: project.brief, mode: project.mode, ...(project.avatarScript ? { avatarScript: project.avatarScript } : {}), targetDurationSeconds: project.targetDurationSeconds,
      status: project.status, assets: project.assets.map(asset),
      ...(project.plan ? { plan: { schemaVersion: project.plan.schemaVersion, document: project.plan as unknown as JsonObject } } : {}),
      ...(project.output ? { output: { uri: this.#options.toDisplayUri(project.output.uri), kind: "video", origin: "imported", mimeType: project.output.mimeType, byteLength: project.output.sizeBytes, durationSeconds: project.output.durationSeconds, displayName: "本地成片.mp4" } } : {}),
      ...(project.issue ? { issue: project.issue } : {}), createdAt: project.createdAt, updatedAt: project.updatedAt,
    };
  }

  async #emit(projectId: string, event: ProductionEvent): Promise<void> {
    await Promise.all([...(this.#listeners.get(projectId) ?? [])].map((listener) => listener(event)));
  }
}
