import { contentAnalysisResultSchema, ReplicaBlueprintFlow, replicaBlueprintResultSchema, type AiProvider } from "@hongtai/ai";
import { issueFromAppError, MAX_PRODUCTION_DURATION_SECONDS, MIN_PRODUCTION_DURATION_SECONDS, TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  JsonObject,
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

/** Montage needs three separate visuals, so a shorter list cannot be rebuilt this way at all. */
const MIN_MONTAGE_SHOTS = 3;

interface ReplicaFilesPort {
  writeText(options: { readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }): Promise<void>;
  readText(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
}

export interface StandaloneReplicaServiceOptions {
  readonly files: ReplicaFilesPort;
  readonly analysis: Pick<AnalysisService, "get">;
  readonly tasks: Pick<TaskService, "getDetail">;
  readonly production: Pick<ProductionService, "create" | "get">;
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

  constructor(options: StandaloneReplicaServiceOptions) { this.#options = options; }

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
    const operation = this.#run(taskId);
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
    const project = await this.#options.production.get(previous.projectId).catch(() => undefined);
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

  async startProject(taskId: string): Promise<ProductionProjectRecord> {
    const record = await this.get(taskId);
    const parsed = record?.status === "succeeded" && record.blueprint?.schemaVersion === "replica-blueprint.v1"
      ? replicaBlueprintResultSchema.safeParse(record.blueprint.document) : undefined;
    if (!parsed?.success) throw taskError("请先生成这条爆款的素材需求清单");
    const blueprint = parsed.data;
    if (blueprint.shots.length === 0) {
      throw taskError(blueprint.emptyReason ?? "这条内容没有给出可拍摄的分镜，无法复刻", "none");
    }
    if (blueprint.shots.length < MIN_MONTAGE_SHOTS) {
      throw taskError(`素材剪辑至少需要 ${MIN_MONTAGE_SHOTS} 个镜头，这份清单只有 ${blueprint.shots.length} 个`, "none");
    }

    // Reopening the wizard has to land back in the project already being filmed for, or the user
    // would be asked to import everything again into a second project.
    const existing = record?.projectId ? await this.#options.production.get(record.projectId) : undefined;
    if (existing) return existing;

    const total = blueprint.shots.reduce((sum, shot) => sum + shot.material.suggestedDurationSeconds, 0);
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
    if (record) await this.#write({ ...record, projectId: project.projectId, updatedAt: this.#iso() });
    return project;
  }

  async #write(record: ReplicaBlueprintRecord): Promise<ReplicaBlueprintRecord> {
    await this.#options.files.writeText({ taskId: record.taskId, relativePath: BLUEPRINT_PATH, value: JSON.stringify(record), replace: true });
    return record;
  }

  #iso(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }
}
