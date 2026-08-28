import { contentAnalysisResultSchema, ReplicaBlueprintFlow, replicaBlueprintResultSchema, type AiProvider } from "@hongtai/ai";
import {
  issueFromAppError,
  MAX_PRODUCTION_DURATION_SECONDS,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  TaskError,
} from "@hongtai/core";
import type {
  AnalysisService,
  JsonObject,
  ProductionMode,
  ProductionProjectRecord,
  ProductionService,
  ReplicaBlueprintRecord,
  ReplicaService,
  TaskDetailRecord,
  TaskIssue,
  TaskService,
} from "@hongtai/core";

import { citedEvidenceUnits } from "./standalone-analysis-service.js";

const BLUEPRINT_PATH = "replica-blueprint.json";

interface ReplicaFilesPort {
  writeText(options: { readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }): Promise<void>;
  readText(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
}

export interface StandaloneReplicaServiceOptions {
  readonly files: ReplicaFilesPort;
  readonly analysis: Pick<AnalysisService, "get">;
  readonly tasks: Pick<TaskService, "getDetail">;
  readonly production: Pick<ProductionService, "create" | "get" | "delete">;
  readonly getProvider: () => Promise<AiProvider>;
  readonly now?: () => Date;
}

function taskError(message: string, action: TaskIssue["action"] = "retry", code: TaskIssue["code"] = "TASK_ARTIFACT_MISSING"): TaskError {
  return new TaskError({ code, message, action });
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function blueprintDocument(value: unknown): ReplicaBlueprintRecord["blueprint"] {
  const record = object(value);
  if (!record || record.schemaVersion !== "replica-blueprint.v1" || !object(record.document)) return undefined;
  const parsed = replicaBlueprintResultSchema.safeParse(record.document);
  if (!parsed.success) return undefined;
  return { schemaVersion: "replica-blueprint.v1", document: JSON.parse(JSON.stringify(parsed.data)) as JsonObject };
}

/**
 * The reference copy the originality rule compares against. Bounded the same way production
 * planning bounds it, so the blueprint is judged against what the planner will also see.
 */
function originalSourceText(detail: TaskDetailRecord | undefined): string | undefined {
  const direct = detail?.transcript?.text?.trim() || detail?.imageText?.text?.trim();
  const evidence = detail?.evidenceUnits.map((unit) => unit.text.trim()).filter(Boolean).join("\n");
  const value = (direct || evidence)?.replace(/\s+/gu, " ").trim();
  return value ? value.slice(0, 12_000) : undefined;
}

/**
 * Turns a finished breakdown into the list of material the user has to film, and opens the project
 * that list will be rebuilt in.
 *
 * Only terminal records are written. A run killed with the process leaves the previous record
 * untouched instead of a row that claims to still be generating.
 */
export class StandaloneReplicaService implements ReplicaService {
  readonly #options: StandaloneReplicaServiceOptions;
  readonly #active = new Map<string, Promise<ReplicaBlueprintRecord>>();
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(options: StandaloneReplicaServiceOptions) { this.#options = options; }

  /**
   * One writer per breakdown. `run` and `startProject` are both read-modify-write over the same
   * file, so interleaving them could drop the project link or write a stale blueprint back over a
   * newer one.
   */
  async #exclusive<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#mutations.has(taskId)) throw taskError("这条爆款正在处理另一项操作，请稍后再试");
    const active = operation();
    this.#mutations.set(taskId, active);
    try {
      return await active;
    } finally {
      if (this.#mutations.get(taskId) === active) this.#mutations.delete(taskId);
    }
  }

  async get(taskId: string): Promise<ReplicaBlueprintRecord | undefined> {
    const response = await this.#options.files.readText({ taskId, relativePath: BLUEPRINT_PATH });
    if (!response.value) return undefined;
    try {
      const value = object(JSON.parse(response.value));
      if (!value || value.taskId !== taskId || (value.status !== "succeeded" && value.status !== "failed")) return undefined;
      if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return undefined;
      const blueprint = blueprintDocument(value.blueprint);
      if (value.status === "succeeded" && !blueprint) return undefined;
      return {
        taskId,
        status: value.status,
        ...(blueprint ? { blueprint } : {}),
        ...(value.issue ? { issue: value.issue as TaskIssue } : {}),
        ...(typeof value.projectId === "string" && value.projectId ? { projectId: value.projectId } : {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
    } catch {
      return undefined;
    }
  }

  run(taskId: string): Promise<ReplicaBlueprintRecord> {
    // One list per breakdown at a time: a second tap would only pay for the same request twice.
    const active = this.#active.get(taskId);
    if (active) return active;
    const operation = this.#exclusive(taskId, () => this.#run(taskId));
    this.#active.set(taskId, operation);
    void operation.finally(() => {
      if (this.#active.get(taskId) === operation) this.#active.delete(taskId);
    }).catch(() => undefined);
    return operation;
  }

  async #run(taskId: string): Promise<ReplicaBlueprintRecord> {
    const previous = await this.get(taskId).catch(() => undefined);
    await this.#refuseIfMaterialAlreadyFilmed(previous);
    const startedAt = previous?.createdAt ?? this.#iso();
    try {
      const blueprint = await new ReplicaBlueprintFlow({ provider: await this.#options.getProvider() }).run(await this.#input(taskId));
      const document = blueprintDocument({ schemaVersion: blueprint.schemaVersion, document: blueprint });
      if (!document) throw taskError("复刻清单结果不符合正式文档结构", "retry", "AI_STRUCTURED_OUTPUT_INVALID");
      return await this.#write({
        taskId,
        status: "succeeded",
        blueprint: document,
        // A regenerated list describes different shots, so the project it was feeding is no longer
        // the project this list belongs to.
        createdAt: startedAt,
        updatedAt: this.#iso(),
      });
    } catch (error) {
      await this.#write({
        taskId,
        status: "failed",
        issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "复刻清单没有生成成功", action: "retry" }),
        ...(previous?.projectId ? { projectId: previous.projectId } : {}),
        createdAt: startedAt,
        updatedAt: this.#iso(),
      }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * A new list describes different shots. Overwriting one whose items have already been filmed would
   * leave the imported clips attached to item numbers that now mean something else — footage
   * silently relabelled rather than a visible failure.
   */
  async #refuseIfMaterialAlreadyFilmed(previous: ReplicaBlueprintRecord | undefined): Promise<void> {
    if (!previous?.projectId) return;
    // Only a project that is genuinely gone clears the way. Treating a failed read as "gone" would
    // let a transient I/O error be the thing that decides it is safe to relabel filmed material.
    let project;
    try {
      project = await this.#options.production.get(previous.projectId);
    } catch (error) {
      throw new TaskError({
        code: "STORAGE_READ_FAILED",
        message: "读不到正在使用这份清单的制作项目，暂时不能重新生成清单。请稍后再试。",
        action: "retry",
        cause: error,
      });
    }
    if (!project?.assets.some((asset) => asset.requirementOrder !== undefined)) return;
    throw taskError(
      "这份清单已经绑定了拍好的素材。要重新生成清单，请先删掉正在使用它的制作项目，否则已拍素材会对不上新的清单项。",
      "none",
    );
  }

  async #input(taskId: string) {
    const record = await this.#options.analysis.get(taskId);
    const analysis = record?.status === "succeeded" && record.result?.schemaVersion === "content-analysis.v1"
      ? contentAnalysisResultSchema.safeParse(record.result.document) : undefined;
    if (!analysis?.success) throw taskError("这条任务还没有可用的正式拆解结果", "view_partial_result");
    const detail = await this.#options.tasks.getDetail(taskId);
    if (!detail) throw taskError("这条任务的本地证据已经不存在了", "view_partial_result");
    const sourceText = originalSourceText(detail);
    return {
      analysis: analysis.data,
      evidenceUnits: citedEvidenceUnits(detail),
      ...(sourceText ? { originalSourceText: sourceText } : {}),
    };
  }

  async startProject(taskId: string, options?: { readonly mode?: ProductionMode }): Promise<ProductionProjectRecord> {
    return this.#exclusive(taskId, () => this.#startProject(taskId, options));
  }

  async #startProject(taskId: string, options?: { readonly mode?: ProductionMode }): Promise<ProductionProjectRecord> {
    const avatar = options?.mode === "avatar";
    const record = await this.get(taskId);
    const parsed = record?.status === "succeeded" && record.blueprint?.schemaVersion === "replica-blueprint.v1"
      ? replicaBlueprintResultSchema.safeParse(record.blueprint.document) : undefined;
    if (!parsed?.success) throw taskError("请先生成这条爆款的素材需求清单");
    const blueprint = parsed.data;
    if (blueprint.shots.length === 0) {
      throw taskError(blueprint.emptyReason ?? "这条内容没有给出可拍摄的分镜，无法复刻", "none");
    }
    // The single avatar video replaces the whole material list, so the montage minimum of three
    // bound visuals does not apply to that path.
    if (!avatar && blueprint.shots.length < MIN_MONTAGE_VISUAL_ASSETS) {
      throw taskError(`素材剪辑至少需要 ${MIN_MONTAGE_VISUAL_ASSETS} 个镜头，这份清单只有 ${blueprint.shots.length} 个`, "none");
    }

    // Reopening the wizard has to land back in the project already being filmed for, or the user
    // would be asked to import everything again into a second project.
    const existing = record?.projectId ? await this.#options.production.get(record.projectId) : undefined;
    if (existing) return existing;

    const total = blueprint.shots.reduce((sum, shot) => sum + shot.material.suggestedDurationSeconds, 0);
    if (avatar) {
      // Script-first pipeline: the finished length comes from the measured narration, so the
      // legacy duration field only needs an in-range placeholder, exactly like the workbench.
      const project = await this.#options.production.create({
        analysisTaskId: taskId,
        brief: blueprint.premise,
        targetDurationSeconds: 30,
        mode: "avatar",
      });
      if (record) await this.#link(record, project);
      return project;
    }
    if (total < MIN_PRODUCTION_DURATION_SECONDS || total > MAX_PRODUCTION_DURATION_SECONDS) {
      throw taskError(`这份清单合计 ${total} 秒，超出可成片的时长范围，请重新生成清单`);
    }
    const project = await this.#options.production.create({
      analysisTaskId: taskId,
      brief: blueprint.premise,
      // The list's own total, so the shots the user films are the length the list described
      // instead of being squeezed into a preset they never picked.
      targetDurationSeconds: total,
    });
    if (record) await this.#link(record, project);
    return project;
  }

  /**
   * `create` can outlive the WebView, so the in-process lock is not enough: the link is written
   * against a fresh read rather than the snapshot this call started from. If the list has since been
   * regenerated or already points at a project, the empty project we just made is removed instead of
   * being left behind as an orphan.
   */
  async #link(started: ReplicaBlueprintRecord, project: ProductionProjectRecord): Promise<void> {
    const current = await this.get(started.taskId);
    if (current?.projectId && current.projectId !== project.projectId) {
      await this.#options.production.delete(project.projectId).catch(() => undefined);
      throw taskError("这条爆款已经在另一个制作项目里开始复刻了，请回到那个项目继续", "none");
    }
    if (current && current.updatedAt !== started.updatedAt) {
      await this.#options.production.delete(project.projectId).catch(() => undefined);
      throw taskError("素材需求清单刚刚被重新生成了，请按新的清单再建一次项目");
    }
    await this.#write({ ...(current ?? started), projectId: project.projectId, updatedAt: this.#iso() });
  }

  async #write(record: ReplicaBlueprintRecord): Promise<ReplicaBlueprintRecord> {
    await this.#options.files.writeText({ taskId: record.taskId, relativePath: BLUEPRINT_PATH, value: JSON.stringify(record), replace: true });
    return record;
  }

  #iso(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }
}
