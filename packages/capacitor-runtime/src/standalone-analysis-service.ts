import { ContentAnalysisFlow, contentAnalysisResultSchema } from "@hongtai/ai";
import type { AiProvider, ContentAnalysisInput, ContentAnalysisRunRecord, ContentAnalysisStore } from "@hongtai/ai";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  ContentAnalysisRecord,
  JsonObject,
  TaskDetailRecord,
  TaskIssue,
} from "@hongtai/core";

import type { StandaloneTaskFilesPlugin } from "./standalone-task-service.js";

const ANALYSIS_PATH = "analysis.json";

export interface StandaloneAnalysisTaskPort {
  getDetail(taskId: string): Promise<TaskDetailRecord | undefined>;
  setAnalysisStatus(taskId: string, status: "not_started" | "running" | "succeeded" | "failed"): Promise<void>;
}

export interface StandaloneAnalysisServiceOptions {
  readonly files: StandaloneTaskFilesPlugin;
  readonly tasks: StandaloneAnalysisTaskPort;
  readonly getProvider: () => Promise<AiProvider>;
  readonly now?: () => Date;
}

function taskError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string, action: ConstructorParameters<typeof TaskError>[0]["action"] = "none"): TaskError {
  return new TaskError({ code, message, action });
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function formalDocument(value: unknown): ContentAnalysisRecord["result"] {
  const record = object(value);
  if (!record || record.schemaVersion !== "content-analysis.v1" || !object(record.document)) return undefined;
  const parsed = contentAnalysisResultSchema.safeParse(record.document);
  if (!parsed.success) return undefined;
  return { schemaVersion: "content-analysis.v1", document: JSON.parse(JSON.stringify(parsed.data)) as JsonObject };
}

function analysisInput(taskId: string, detail: TaskDetailRecord | undefined): ContentAnalysisInput {
  if (!detail || detail.task.id !== taskId || !detail.task.platform) {
    throw taskError("TASK_ARTIFACT_MISSING", "未找到可供拆解的本地任务证据", "view_partial_result");
  }
  if (detail.task.contentType === "image_text") {
    const evidenceUnits = detail.evidenceUnits.filter((item) => item.source === "image_text")
      .map(({ id, text, startSeconds, endSeconds }) => ({ id, text, ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) }));
    if (evidenceUnits.length === 0) throw taskError("TASK_ARTIFACT_MISSING", "图文任务没有已保存的正文证据", "view_partial_result");
    return {
      taskId,
      platform: detail.task.platform,
      contentType: "image_text",
      sourceKind: "image_text",
      ...(detail.content.title ? { title: detail.content.title } : {}),
      ...(detail.content.author ? { author: detail.content.author } : {}),
      evidenceUnits,
    };
  }
  if (detail.task.contentType !== "video" || !detail.transcript) {
    throw taskError("TASK_ARTIFACT_MISSING", "视频任务没有可用的已保存文稿", "view_partial_result");
  }
  const evidenceUnits = detail.evidenceUnits.filter((item) => item.source === "transcript")
    .map(({ id, text, startSeconds, endSeconds }) => ({ id, text, ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) }));
  if (evidenceUnits.length === 0) throw taskError("TASK_ARTIFACT_MISSING", "视频任务没有可供拆解的文稿证据", "view_partial_result");
  return {
    taskId,
    platform: detail.task.platform,
    contentType: "video",
    sourceKind: detail.transcript.source,
    ...(detail.content.title ? { title: detail.content.title } : {}),
    ...(detail.content.author ? { author: detail.content.author } : {}),
    evidenceUnits,
  };
}

/**
 * Content analysis persistence is one formal `content-analysis.v1` document
 * per task. Raw provider output and reasoning deliberately stay out of the
 * local UI store.
 */
export class StandaloneAnalysisService implements AnalysisService {
  readonly #files: StandaloneTaskFilesPlugin;
  readonly #tasks: StandaloneAnalysisTaskPort;
  readonly #getProvider: () => Promise<AiProvider>;
  readonly #now: () => Date;

  constructor(options: StandaloneAnalysisServiceOptions) {
    this.#files = options.files;
    this.#tasks = options.tasks;
    this.#getProvider = options.getProvider;
    this.#now = options.now ?? (() => new Date());
  }

  async get(taskId: string): Promise<ContentAnalysisRecord | undefined> {
    const response = await this.#files.readText({ taskId, relativePath: ANALYSIS_PATH });
    if (!response.value) return undefined;
    try {
      const value = object(JSON.parse(response.value));
      if (!value || value.taskId !== taskId || (value.status !== "not_started" && value.status !== "running" && value.status !== "succeeded" && value.status !== "failed") ||
          typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
        return undefined;
      }
      const result = formalDocument(value.result);
      const issue = value.issue ? value.issue as TaskIssue : undefined;
      if (value.status === "succeeded" && !result) return undefined;
      return {
        taskId,
        status: value.status,
        ...(result ? { result } : {}),
        ...(issue ? { issue } : {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
    } catch {
      return undefined;
    }
  }

  async run(taskId: string): Promise<ContentAnalysisRecord> {
    const startedAt = iso(this.#now);
    await this.#tasks.setAnalysisStatus(taskId, "running");
    await this.#write({ taskId, status: "running", createdAt: startedAt, updatedAt: startedAt });
    const store: ContentAnalysisStore = {
      loadInput: async (requestedTaskId) => analysisInput(requestedTaskId, await this.#tasks.getDetail(requestedTaskId)),
      saveResult: async (requestedTaskId, result, run) => {
        const document = formalDocument({ schemaVersion: result.schemaVersion, document: result });
        if (!document) throw taskError("AI_STRUCTURED_OUTPUT_INVALID", "内容拆解结果不符合正式文档结构", "retry");
        await this.#tasks.setAnalysisStatus(requestedTaskId, "succeeded");
        await this.#write({
          taskId: requestedTaskId,
          status: "succeeded",
          result: document,
          createdAt: run.startedAt,
          updatedAt: run.completedAt,
        });
      },
      saveFailedRun: async (requestedTaskId, run) => {
        const issue = this.#issueFromRun(run);
        await this.#tasks.setAnalysisStatus(requestedTaskId, "failed");
        await this.#write({ taskId: requestedTaskId, status: "failed", issue, createdAt: run.startedAt, updatedAt: run.completedAt });
      },
    };
    try {
      const flow = new ContentAnalysisFlow({ provider: await this.#getProvider(), store });
      await flow.run(taskId);
      const record = await this.get(taskId);
      if (!record || record.status !== "succeeded" || !record.result) {
        throw taskError("STORAGE_WRITE_FAILED", "内容拆解完成后没有保存正式本地文档", "free_storage");
      }
      return record;
    } catch (error) {
      const current = await this.get(taskId).catch(() => undefined);
      if (current?.status !== "failed") {
        const issue = issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "内容拆解没有完成", action: "retry" });
        await this.#tasks.setAnalysisStatus(taskId, "failed").catch(() => undefined);
        await this.#write({ taskId, status: "failed", issue, createdAt: startedAt, updatedAt: iso(this.#now) }).catch(() => undefined);
      }
      throw error;
    }
  }

  async #write(record: ContentAnalysisRecord): Promise<void> {
    await this.#files.writeText({ taskId: record.taskId, relativePath: ANALYSIS_PATH, value: JSON.stringify(record), replace: true });
  }

  #issueFromRun(run: ContentAnalysisRunRecord): TaskIssue {
    const code = run.errorCode ?? "INTERNAL_UNKNOWN_ERROR";
    return {
      code: code as TaskIssue["code"],
      severity: "error",
      userMessage: "内容拆解没有生成可展示的正式结果。",
      retryable: code === "AI_NETWORK_FAILED" || code === "AI_TIMEOUT" || code === "AI_SERVER_ERROR" || code === "AI_RATE_LIMITED",
      action: code === "AI_NOT_CONFIGURED" || code === "AI_SETTINGS_INVALID" ? "configure_ai" : "retry",
    };
  }
}
