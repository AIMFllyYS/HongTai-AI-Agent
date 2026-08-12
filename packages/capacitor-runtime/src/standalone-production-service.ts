import { contentAnalysisResultSchema, ProductionPlanningFlow, productionPlanResultSchema, type AiProvider, type ProductionPlanResultV1 } from "@hongtai/ai";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  JsonObject,
  ProductionAsset,
  ProductionEvent,
  ProductionProjectRecord,
  ProductionService,
  TaskIssue,
} from "@hongtai/core";

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

interface PersistedProject {
  readonly projectId: string;
  readonly analysisTaskId: string;
  readonly brief: string;
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
  readonly toDisplayUri: (uri: string) => string;
  readonly createProjectId?: () => string;
  readonly now?: () => Date;
}

function taskError(message: string, action: "retry" | "select_media" = "retry"): TaskError {
  return new TaskError({ code: "TASK_ARTIFACT_MISSING", message, action });
}

function nativeAsset(value: NativeProductionAsset): NativeProductionAsset | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value.id) || !value.uri || !value.displayName || value.sizeBytes <= 0) return undefined;
  if (value.kind === "image" && !["image/jpeg", "image/png", "image/webp"].includes(value.mimeType)) return undefined;
  if (value.kind === "video" && value.mimeType !== "video/mp4") return undefined;
  if (value.kind === "audio" && !["audio/mpeg", "audio/mp4", "audio/wav"].includes(value.mimeType)) return undefined;
  return value;
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
    const assets = parsed.assets.map(nativeAsset);
    if (assets.some((asset) => !asset)) return undefined;
    const plan = parsed.plan ? productionPlanResultSchema.safeParse(parsed.plan) : undefined;
    if (parsed.plan && !plan?.success) return undefined;
    return { ...parsed, assets: assets as readonly NativeProductionAsset[], ...(plan?.success ? { plan: plan.data } : {}) };
  } catch {
    return undefined;
  }
}

export class StandaloneProductionService implements ProductionService {
  readonly #options: StandaloneProductionServiceOptions;
  readonly #listeners = new Map<string, Set<(event: ProductionEvent) => void | Promise<void>>>();
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(options: StandaloneProductionServiceOptions) { this.#options = options; }

  async create(input: { readonly analysisTaskId: string; readonly brief: string; readonly targetDurationSeconds: number }): Promise<ProductionProjectRecord> {
    const brief = input.brief.trim();
    if (!brief) throw taskError("请填写制作需求");
    if (input.targetDurationSeconds < 15 || input.targetDurationSeconds > 60) throw taskError("制作时长必须在15到60秒之间");
    const projectId = this.#options.createProjectId?.() ?? crypto.randomUUID();
    const timestamp = (this.#options.now ?? (() => new Date()))().toISOString();
    const project: PersistedProject = { projectId, analysisTaskId: input.analysisTaskId, brief, targetDurationSeconds: input.targetDurationSeconds, status: "draft", assets: [], createdAt: timestamp, updatedAt: timestamp };
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
    return this.#exclusive(projectId, () => this.#importAssets(projectId));
  }

  async #importAssets(projectId: string): Promise<ProductionProjectRecord> {
    const project = await this.#required(projectId);
    const remaining = 12 - project.assets.length;
    if (remaining <= 0) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const result = await this.#options.native.pickAssets({ projectId, maxItems: remaining });
    const imported = result.assets.map(nativeAsset).filter((asset): asset is NativeProductionAsset => Boolean(asset));
    if (imported.length === 0) throw taskError("没有导入可用的图片、视频或音频", "select_media");
    const combined = new Map([...project.assets, ...imported].map((asset) => [asset.id, asset]));
    if (combined.size > 12) throw taskError("每个制作项目最多使用12个素材", "select_media");
    const { plan: _plan, output: _output, issue: _issue, ...base } = project;
    void _plan; void _output; void _issue;
    return this.#project(await this.#persist({ ...base, assets: [...combined.values()], status: "draft" }));
  }

  async generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#generatePlan(projectId));
  }

  async #generatePlan(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    if (project.assets.length < 3) throw taskError("请至少导入3个制作素材", "select_media");
    const { plan: _plan, output: _output, issue: _issue, ...planningBase } = project;
    void _plan; void _output; void _issue;
    project = await this.#persist({ ...planningBase, status: "planning" });
    try {
      const record = await this.#options.analysis.get(project.analysisTaskId);
      const parsed = record?.status === "succeeded" && record.result?.schemaVersion === "content-analysis.v1"
        ? contentAnalysisResultSchema.safeParse(record.result.document) : undefined;
      if (!parsed?.success) throw taskError("来源任务尚无可用的正式拆解结果");
      const plan = await new ProductionPlanningFlow({ provider: await this.#options.getProvider() }).run({
        analysisTaskId: project.analysisTaskId,
        brief: project.brief,
        targetDurationSeconds: project.targetDurationSeconds,
        analysis: parsed.data,
        assets: project.assets,
      });
      await this.#options.files.writeProductionText({ projectId, relativePath: PLAN_PATH, value: JSON.stringify(plan), replace: true });
      return this.#project(await this.#persist({ ...project, status: "ready", plan }));
    } catch (error) {
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "制作计划没有完成", action: "retry" }) });
      throw error;
    }
  }

  async render(projectId: string): Promise<ProductionProjectRecord> {
    return this.#exclusive(projectId, () => this.#render(projectId));
  }

  async #render(projectId: string): Promise<ProductionProjectRecord> {
    let project = await this.#required(projectId);
    if (!project.plan) throw taskError("请先生成可执行制作计划");
    const { output: _output, issue: _issue, ...renderBase } = project;
    void _output; void _issue;
    project = await this.#persist({ ...renderBase, status: "rendering" });
    const handle = await this.#options.native.addListener?.("productionProgress", (event) => {
      if (event.projectId === projectId) void this.#emit(projectId, { type: "render-progress", ...event });
    });
    try {
      const output = await this.#options.native.render({ projectId, planJson: JSON.stringify(project.plan) });
      return this.#project(await this.#persist({ ...project, status: "succeeded", output }));
    } catch (error) {
      await this.#persist({ ...project, status: "failed", issue: issueFromAppError(error, { code: "MEDIA_MERGE_FAILED", message: "本地视频合成没有完成", action: "retry" }) });
      throw error;
    } finally {
      await handle?.remove();
    }
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
        throw error;
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
        throw error;
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
    const asset = (value: NativeProductionAsset): ProductionAsset => ({ id: value.id, uri: this.#options.toDisplayUri(value.uri), kind: value.kind, origin: "imported", mimeType: value.mimeType, displayName: value.displayName, byteLength: value.sizeBytes, ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }) });
    return {
      projectId: project.projectId, analysisTaskId: project.analysisTaskId, brief: project.brief, targetDurationSeconds: project.targetDurationSeconds,
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
