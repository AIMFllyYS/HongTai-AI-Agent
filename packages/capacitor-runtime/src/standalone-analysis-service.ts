import { ContentAnalysisFlow, contentAnalysisResultSchema } from "@hongtai/ai";
import type { AiProvider, ContentAnalysisInput, ContentAnalysisRunRecord, ContentAnalysisStore } from "@hongtai/ai";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  AppTaskRecord,
  CancellableTask,
  ContentAnalysisEventListener,
  ContentAnalysisStreamEvent,
  ContentAnalysisRecord,
  JsonObject,
  RuntimeUnfinishedWork,
  StructuredGenerationModuleId,
  StructuredGenerationProgressV1,
  TaskDetailRecord,
  TaskIssue,
  VideoImportRecovery,
} from "@hongtai/core";

import type { StandaloneTaskFilesPlugin, TaskVideoRecovery } from "./standalone-task-service.js";
import { persistedRuntimeWork, runtimeInterruptedIssue } from "./runtime-interruption.js";
import type { RuntimeOperationRegistry } from "./runtime-operation-registry.js";

const ANALYSIS_PATH = "analysis.json";

export interface StandaloneAnalysisTaskPort {
  importVideo(): Promise<AppTaskRecord>;
  consumeVideoRecovery(): Promise<TaskVideoRecovery>;
  start(taskId: string): Promise<CancellableTask>;
  getDetail(taskId: string): Promise<TaskDetailRecord | undefined>;
  list?(): Promise<readonly AppTaskRecord[]>;
  setAnalysisStatus(taskId: string, status: "not_started" | "running" | "succeeded" | "failed"): Promise<void>;
}

export interface StandaloneAnalysisServiceOptions {
  readonly files: StandaloneTaskFilesPlugin;
  readonly tasks: StandaloneAnalysisTaskPort;
  readonly getProvider: () => Promise<AiProvider>;
  readonly now?: () => Date;
  readonly operations?: RuntimeOperationRegistry;
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
  if (!detail || detail.task.id !== taskId) {
    throw taskError("TASK_ARTIFACT_MISSING", "未找到可供拆解的本地任务证据", "view_partial_result");
  }
  const platform = detail.task.sourceKind === "local_video" ? "local_upload" as const : detail.task.platform;
  if (!platform) throw taskError("TASK_ARTIFACT_MISSING", "拆解任务缺少明确来源", "view_partial_result");
  if (detail.task.contentType === "image_text") {
    const evidenceUnits = detail.evidenceUnits.filter((item) => item.source === "image_text")
      .map(({ id, text, startSeconds, endSeconds }) => ({ id, text, ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) }));
    if (evidenceUnits.length === 0) throw taskError("TASK_ARTIFACT_MISSING", "图文任务没有已保存的正文证据", "view_partial_result");
    return {
      taskId,
      platform,
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
    platform,
    contentType: "video",
    sourceKind: detail.transcript.source,
    ...(detail.content.title ? { title: detail.content.title } : {}),
    ...(detail.content.author ? { author: detail.content.author } : {}),
    evidenceUnits,
  };
}

/** Keep the actionable ASR cause ahead of its trailing partial-failure summary. */
export function localVideoFailureIssue(issues: readonly TaskIssue[]): TaskIssue | undefined {
  let original: TaskIssue | undefined;
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    const issue = issues[index];
    if (!issue || issue.code === "ASR_PARTIAL_FAILURE") continue;
    original ??= issue;
    if (issue.action === "configure_ai" || issue.action === "check_network" || issue.action === "wait_and_retry") {
      return issue;
    }
  }
  return original ?? issues[issues.length - 1];
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
  readonly #operations?: RuntimeOperationRegistry;
  readonly #active = new Map<string, Promise<ContentAnalysisRecord>>();
  readonly #listeners = new Map<string, Set<ContentAnalysisEventListener>>();
  readonly #snapshots = new Map<string, StructuredGenerationProgressV1>();

  constructor(options: StandaloneAnalysisServiceOptions) {
    this.#files = options.files;
    this.#tasks = options.tasks;
    this.#getProvider = options.getProvider;
    this.#now = options.now ?? (() => new Date());
    this.#operations = options.operations;
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

  async importVideo(onEvent?: ContentAnalysisEventListener): Promise<ContentAnalysisRecord> {
    return this.#finishImportedVideo(await this.#tasks.importVideo(), onEvent);
  }

  async consumeVideoRecovery(onEvent?: ContentAnalysisEventListener): Promise<VideoImportRecovery> {
    let recovered: TaskVideoRecovery;
    try {
      recovered = await this.#tasks.consumeVideoRecovery();
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "视频选择恢复失败，请重新选择", action: "select_media" }) };
    }
    if (recovered.status !== "succeeded") return recovered;
    try {
      return { status: "succeeded", record: await this.#finishImportedVideo(recovered.task, onEvent) };
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "本地视频没有完成自动拆解", action: "select_media" }) };
    }
  }

  async #finishImportedVideo(imported: AppTaskRecord, onEvent?: ContentAnalysisEventListener): Promise<ContentAnalysisRecord> {
    const ingest = await this.#tasks.start(imported.id);
    const completed = await ingest.completion;
    if (completed.status !== "succeeded" && completed.status !== "degraded") {
      const issue = localVideoFailureIssue(completed.issues);
      throw taskError(issue?.code ?? "MEDIA_IMPORT_FAILED", issue?.userMessage ?? "本地视频处理没有完成", issue?.action ?? "retry");
    }
    if (completed.speechStatus === "no_speech") {
      throw taskError("AI_EMPTY_RESPONSE", "没有听清可供拆解的口播内容，请换一段人声清晰的视频", "select_media");
    }
    return this.run(imported.id, onEvent);
  }

  run(taskId: string, onEvent?: ContentAnalysisEventListener): Promise<ContentAnalysisRecord> {
    const active = this.#active.get(taskId);
    if (active) {
      const listener = onEvent ? this.#attachRunListener(taskId, onEvent) : undefined;
      if (listener) void active.finally(() => this.#removeListener(taskId, listener)).catch(() => undefined);
      return active;
    }
    const listener = onEvent ? this.#attachRunListener(taskId, onEvent) : undefined;
    const execute = () => this.#run(taskId);
    const operation = this.#operations
      ? this.#operations.track({ kind: "content-analysis", id: taskId, execution: "in-process" }, execute)
      : execute();
    this.#active.set(taskId, operation);
    void operation.finally(() => {
      if (this.#active.get(taskId) === operation) {
        this.#active.delete(taskId);
        this.#snapshots.delete(taskId);
      }
      if (listener) this.#removeListener(taskId, listener);
    }).catch(() => undefined);
    return operation;
  }

  subscribe(taskId: string, listener: ContentAnalysisEventListener): () => void {
    this.#addListener(taskId, listener);
    const snapshot = this.#snapshots.get(taskId);
    if (snapshot) void this.#notifyListener(listener, { type: "progress", taskId, progress: snapshot });
    return () => {
      const listeners = this.#listeners.get(taskId);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(taskId);
    };
  }

  async #run(taskId: string): Promise<ContentAnalysisRecord> {
    const startedAt = iso(this.#now);
    await this.#write({ taskId, status: "running", createdAt: startedAt, updatedAt: startedAt });
    await this.#tasks.setAnalysisStatus(taskId, "running");
    const store: ContentAnalysisStore = {
      loadInput: async (requestedTaskId) => analysisInput(requestedTaskId, await this.#tasks.getDetail(requestedTaskId)),
      saveResult: async (requestedTaskId, result, run) => {
        const document = formalDocument({ schemaVersion: result.schemaVersion, document: result });
        if (!document) throw taskError("AI_STRUCTURED_OUTPUT_INVALID", "内容拆解结果不符合正式文档结构", "retry");
        await this.#write({
          taskId: requestedTaskId,
          status: "succeeded",
          result: document,
          createdAt: run.startedAt,
          updatedAt: run.completedAt,
        });
        await this.#tasks.setAnalysisStatus(requestedTaskId, "succeeded");
      },
      saveFailedRun: async (requestedTaskId, run) => {
        const issue = this.#issueFromRun(run);
        await this.#write({ taskId: requestedTaskId, status: "failed", issue, createdAt: run.startedAt, updatedAt: run.completedAt });
        await this.#tasks.setAnalysisStatus(requestedTaskId, "failed");
      },
    };
    try {
      const flow = new ContentAnalysisFlow({
        provider: await this.#getProvider(),
        store,
        onProgress: (progress) => {
          this.#snapshots.set(taskId, progress);
          this.#notify(taskId, { type: "progress", taskId, progress });
        },
      });
      await flow.run(taskId);
      const record = await this.get(taskId);
      if (!record || record.status !== "succeeded" || !record.result) {
        throw taskError("STORAGE_WRITE_FAILED", "内容拆解完成后没有保存正式本地文档", "free_storage");
      }
      this.#notify(taskId, { type: "completed", taskId, record });
      return record;
    } catch (error) {
      const current = await this.get(taskId).catch(() => undefined);
      let failure = current?.issue;
      if (current?.status !== "failed") {
        const issue = issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "内容拆解没有完成", action: "retry" });
        failure = issue;
        await this.#write({ taskId, status: "failed", issue, createdAt: startedAt, updatedAt: iso(this.#now) }).catch(() => undefined);
        await this.#tasks.setAnalysisStatus(taskId, "failed").catch(() => undefined);
      }
      const issue = failure ?? issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "内容拆解没有完成", action: "retry" });
      const progress = this.#snapshots.get(taskId) ?? this.#emptyProgress();
      this.#notify(taskId, {
        type: "failed",
        taskId,
        issue,
        ...(this.#failedModuleId(progress) ? { failedModuleId: this.#failedModuleId(progress) } : {}),
        progress,
      });
      throw error;
    }
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const [{ taskIds }, tasks] = await Promise.all([
      this.#files.listTaskIds(),
      this.#tasks.list?.() ?? Promise.resolve([]),
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const ids = new Set([...taskIds, ...tasks.filter((task) => task.analysisStatus === "running").map((task) => task.id)]);
    const unfinished: RuntimeUnfinishedWork[] = [];
    for (const taskId of ids) {
      const record = await this.get(taskId);
      if (record?.status === "running" || taskById.get(taskId)?.analysisStatus === "running") {
        unfinished.push(persistedRuntimeWork("content-analysis", taskId));
      }
    }
    return unfinished;
  }

  async recoverInterruptedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const unfinished = await this.inspectUnfinishedWork();
    const recovered: RuntimeUnfinishedWork[] = [];
    for (const work of unfinished) {
      const current = await this.get(work.id);
      const updatedAt = iso(this.#now);
      await this.#write({
        taskId: work.id,
        status: "failed",
        issue: runtimeInterruptedIssue(),
        createdAt: current?.createdAt ?? updatedAt,
        updatedAt,
      });
      await this.#tasks.setAnalysisStatus(work.id, "failed");
      recovered.push(work);
    }
    return recovered;
  }

  async #write(record: ContentAnalysisRecord): Promise<void> {
    await this.#files.writeText({ taskId: record.taskId, relativePath: ANALYSIS_PATH, value: JSON.stringify(record), replace: true });
  }

  #addListener(taskId: string, listener: ContentAnalysisEventListener): void {
    const listeners = this.#listeners.get(taskId) ?? new Set<ContentAnalysisEventListener>();
    listeners.add(listener);
    this.#listeners.set(taskId, listeners);
  }

  #attachRunListener(taskId: string, onEvent: ContentAnalysisEventListener): ContentAnalysisEventListener {
    const listener: ContentAnalysisEventListener = (event) => onEvent(event);
    this.#addListener(taskId, listener);
    const snapshot = this.#snapshots.get(taskId);
    if (snapshot) void this.#notifyListener(listener, { type: "progress", taskId, progress: snapshot });
    return listener;
  }

  #removeListener(taskId: string, listener: ContentAnalysisEventListener): void {
    const listeners = this.#listeners.get(taskId);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(taskId);
  }

  #notify(taskId: string, event: ContentAnalysisStreamEvent): void {
    const listeners = this.#listeners.get(taskId);
    if (!listeners) return;
    for (const listener of listeners) void this.#notifyListener(listener, event);
  }

  async #notifyListener(listener: ContentAnalysisEventListener, event: ContentAnalysisStreamEvent): Promise<void> {
    try {
      await listener(event);
    } catch {
      // Page lifecycle changes cannot affect a persisted formal result.
    }
  }

  #emptyProgress(): StructuredGenerationProgressV1 {
    return {
      schemaVersion: "structured-generation-progress.v1",
      flow: "content-analysis",
      phase: "preparing",
      modules: (["overview", "hook-drivers", "structure-claims", "style-template", "risks-boundaries"] as const)
        .map((moduleId) => ({ moduleId, status: "pending" as const })),
    };
  }

  #failedModuleId(progress: StructuredGenerationProgressV1): StructuredGenerationModuleId | undefined {
    return progress.modules.find((module) => module.status === "failed")?.moduleId;
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
