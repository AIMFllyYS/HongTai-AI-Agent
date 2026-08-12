import { IngestPipeline, TaskError, inspectInput, safeUrlForDisplay } from "@hongtai/core";
import type {
  AppTaskRecord,
  CancellableTask,
  HttpClient,
  IngestPipelineDependencies,
  MediaDownloader,
  MediaReference,
  MediaTools,
  PlatformAdapter,
  ProgressEvent,
  TaskCreateRequest,
  TaskDetailRecord,
  TaskEventListener,
  TaskEventRecord,
  TaskIssue,
  TaskListOptions,
  TaskRecord,
  TaskRecoveryProjection,
  RuntimeUnfinishedWork,
  TaskService,
  TaskStatus,
} from "@hongtai/core";

import { NativeTaskFiles } from "./thin-task-files.js";
import type { LocalTaskFilesPlugin } from "./thin-task-files.js";
import type { RuntimeOperationRegistry } from "./runtime-operation-registry.js";

const TASK_REQUEST_PATH = "request.json";
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export interface StandaloneTaskFilesPlugin extends LocalTaskFilesPlugin {
  readText(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  exists(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly exists: boolean }>;
  listTaskIds(): Promise<{ readonly taskIds: readonly string[] }>;
  getUri(options: { readonly taskId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
}

export interface StandaloneTaskServiceOptions {
  readonly files: StandaloneTaskFilesPlugin;
  readonly adapters: readonly PlatformAdapter[];
  readonly http: HttpClient;
  readonly downloader: MediaDownloader;
  readonly mediaTools: MediaTools;
  readonly transcriber?: IngestPipelineDependencies["transcriber"];
  readonly rewriter?: IngestPipelineDependencies["rewriter"];
  readonly toDisplayUri: (nativeUri: string) => string;
  readonly createTaskId?: () => string;
  readonly now?: () => Date;
  readonly operations?: RuntimeOperationRegistry;
}

type StoredTaskRequest = { readonly normalizedUrl: string };

function currentIso(now: () => Date): string {
  return now().toISOString();
}

function taskError(
  code: ConstructorParameters<typeof TaskError>[0]["code"],
  message: string,
  action: ConstructorParameters<typeof TaskError>[0]["action"] = "none",
): TaskError {
  return new TaskError({ code, message, action });
}

function generatedTaskId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (uuid) return `task-${uuid}`;
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "degraded" ||
    value === "failed" || value === "cancelled" || value === "interrupted";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function toAppTask(task: TaskRecord, media: readonly MediaReference[] = []): AppTaskRecord {
  if (!TASK_ID_PATTERN.test(task.id) || !isTaskStatus(task.status)) {
    throw taskError("TASK_ARTIFACT_MISSING", "本地任务记录格式无效", "view_partial_result");
  }
  return {
    id: task.id,
    sourceUrl: safeUrlForDisplay(task.sourceUrl),
    status: task.status,
    ...(task.currentStage ? { currentStage: task.currentStage } : {}),
    ...(task.platform ? { platform: task.platform } : {}),
    ...(task.contentType ? { contentType: task.contentType } : {}),
    ...(task.speechStatus ? { speechStatus: task.speechStatus } : {}),
    analysisStatus: task.analysisStatus ?? "not_started",
    ...(task.retryOfTaskId ? { retryOfTaskId: task.retryOfTaskId } : {}),
    ...(task.cancelRequestedAt ? { cancelRequestedAt: task.cancelRequestedAt } : {}),
    ...(task.cancelledAt ? { cancelledAt: task.cancelledAt } : {}),
    ...(task.interruptedAt ? { interruptedAt: task.interruptedAt } : {}),
    media,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    issues: task.issues,
  };
}

function eventFromJson(value: unknown): TaskEventRecord | undefined {
  const record = asRecord(value);
  const sequence = record?.sequence;
  if (!record || typeof record.taskId !== "string" || typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) return undefined;
  if (record.kind === "task-status") return record as unknown as TaskEventRecord;
  if (typeof record.stage !== "string" || typeof record.status !== "string" || typeof record.message !== "string" || typeof record.timestamp !== "string") return undefined;
  return record as unknown as TaskEventRecord;
}

function contentString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function issueForInterrupted(): TaskIssue {
  return {
    code: "TASK_INTERRUPTED",
    severity: "warning",
    userMessage: "应用上次退出时任务尚未完成，请重新提交链接。",
    retryable: false,
    action: "edit_input",
  };
}

/**
 * File-backed UI service. It delegates execution entirely to the existing
 * IngestPipeline; this class only persists/reads safe task projections and
 * fans out pipeline progress to the current page.
 */
export class StandaloneTaskService implements TaskService {
  readonly #files: StandaloneTaskFilesPlugin;
  readonly #artifactStore: NativeTaskFiles;
  readonly #adapters: readonly PlatformAdapter[];
  readonly #http: HttpClient;
  readonly #downloader: MediaDownloader;
  readonly #mediaTools: MediaTools;
  readonly #transcriber: IngestPipelineDependencies["transcriber"];
  readonly #rewriter: IngestPipelineDependencies["rewriter"];
  readonly #toDisplayUri: (nativeUri: string) => string;
  readonly #createTaskId: () => string;
  readonly #now: () => Date;
  readonly #operations?: RuntimeOperationRegistry;
  readonly #active = new Map<string, CancellableTask>();
  readonly #listeners = new Map<string, Set<TaskEventListener>>();

  constructor(options: StandaloneTaskServiceOptions) {
    this.#files = options.files;
    this.#artifactStore = new NativeTaskFiles(options.files);
    this.#adapters = options.adapters;
    this.#http = options.http;
    this.#downloader = options.downloader;
    this.#mediaTools = options.mediaTools;
    this.#transcriber = options.transcriber;
    this.#rewriter = options.rewriter;
    this.#toDisplayUri = options.toDisplayUri;
    this.#createTaskId = options.createTaskId ?? generatedTaskId;
    this.#now = options.now ?? (() => new Date());
    this.#operations = options.operations;
  }

  inspectInput(input: string) {
    return inspectInput(input);
  }

  async create(input: TaskCreateRequest): Promise<AppTaskRecord> {
    const inspection = inspectInput(input.input);
    if (!inspection.ok) throw new TaskError({ code: inspection.issue.code, message: inspection.issue.userMessage, action: inspection.issue.action });
    const taskId = this.#createTaskId();
    if (!TASK_ID_PATTERN.test(taskId)) throw taskError("INPUT_URL_INVALID", "本地任务标识无效", "edit_input");
    const paths = await this.#artifactStore.initializeTask(taskId);
    const now = currentIso(this.#now);
    const task: TaskRecord = {
      id: taskId,
      sourceUrl: inspection.value.normalizedUrl,
      status: "queued",
      platform: inspection.value.platform,
      analysisStatus: "not_started",
      createdAt: now,
      updatedAt: now,
      issues: [],
      paths,
    };
    await Promise.all([
      this.#artifactStore.writeJson(paths.task, task),
      this.#artifactStore.writeJson(`task://${taskId}/${TASK_REQUEST_PATH}`, { normalizedUrl: inspection.value.normalizedUrl } satisfies StoredTaskRequest),
    ]);
    return toAppTask(task);
  }

  async start(taskId: string): Promise<CancellableTask> {
    const active = this.#active.get(taskId);
    if (active) return active;
    const task = await this.#readTask(taskId);
    if (!task) throw taskError("TASK_ARTIFACT_MISSING", "未找到本地任务", "edit_input");
    if (task.status !== "queued") {
      throw taskError("TASK_INTERRUPTED", "该任务不能在当前状态继续执行，请重新提交链接。", "edit_input");
    }
    const request = await this.#readRequest(taskId);
    const pipeline = new IngestPipeline({
      adapters: this.#adapters,
      http: this.#http,
      downloader: this.#downloader,
      mediaTools: this.#mediaTools,
      ...(this.#transcriber ? { transcriber: this.#transcriber } : {}),
      ...(this.#rewriter ? { rewriter: this.#rewriter } : {}),
      store: this.#artifactStore,
      reporter: { report: async (event) => this.#report(event) },
    });
    const execute = () => pipeline.run({ input: request.normalizedUrl, taskId }).then(async () => {
      const finished = await this.get(taskId);
      if (!finished) throw taskError("TASK_ARTIFACT_MISSING", "任务完成后未找到本地结果", "view_partial_result");
      return finished;
    });
    const completion = this.#operations
      ? this.#operations.track({ kind: "ingest", id: taskId, execution: "in-process" }, execute)
      : execute();
    const cancellable: CancellableTask = {
      taskId,
      completion,
      cancel: async () => { throw taskError("TASK_CANCEL_FAILED", "首版不在任务执行中断路径中写入第二套状态机。", "edit_input"); },
    };
    this.#active.set(taskId, cancellable);
    void completion.finally(() => this.#active.delete(taskId)).catch(() => undefined);
    return cancellable;
  }

  async get(taskId: string): Promise<AppTaskRecord | undefined> {
    const task = await this.#readTask(taskId);
    return task ? toAppTask(task, await this.#taskMedia(task)) : undefined;
  }

  async getDetail(taskId: string): Promise<TaskDetailRecord | undefined> {
    const task = await this.#readTask(taskId);
    if (!task) return undefined;
    const [media, metadata, transcriptText, transcriptInfo, contentText] = await Promise.all([
      this.#taskMedia(task),
      this.#readJson(taskId, "metadata.json"),
      this.#readOptionalText(taskId, "transcript/transcript.txt"),
      this.#readJson(taskId, "transcript/transcript.json"),
      this.#readOptionalText(taskId, "content/content.txt"),
    ]);
    const details = asRecord(metadata) ?? {};
    const title = contentString(details.title);
    const description = contentString(details.description);
    const author = contentString(details.author);
    const canonicalUrl = contentString(details.canonicalUrl);
    const durationSeconds = typeof details.durationSeconds === "number" && Number.isFinite(details.durationSeconds)
      ? details.durationSeconds
      : undefined;
    const content = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(canonicalUrl ? { canonicalUrl: safeUrlForDisplay(canonicalUrl) } : {}),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    };

    if (task.contentType === "image_text") {
      const text = contentText?.trim();
      const paragraphs = text ? text.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean) : [];
      const evidenceUnits = paragraphs.map((textValue, index) => ({ id: `image-text-${index + 1}`, source: "image_text" as const, text: textValue }));
      return {
        task: toAppTask(task, media),
        content,
        media,
        imageText: { ...(text ? { text } : {}), images: media.filter((item) => item.kind === "image"), paragraphs: evidenceUnits },
        evidenceUnits,
      };
    }

    const transcriptDetails = asRecord(transcriptInfo) ?? {};
    const source = transcriptDetails.source === "asr" ? "asr" as const : "description" as const;
    const storedSegments = Array.isArray(transcriptDetails.segments) ? transcriptDetails.segments : [];
    const segments = storedSegments.flatMap((value, index) => {
      const item = asRecord(value);
      const textValue = contentString(item?.text);
      if (!textValue) return [];
      return [{
        id: `transcript-${index + 1}`,
        source: "transcript" as const,
        text: textValue,
        ...(typeof item?.startSeconds === "number" ? { startSeconds: item.startSeconds } : {}),
        ...(typeof item?.endSeconds === "number" ? { endSeconds: item.endSeconds } : {}),
      }];
    });
    const evidenceUnits = segments.length > 0
      ? segments
      : transcriptText?.trim()
        ? [{ id: "transcript-1", source: "transcript" as const, text: transcriptText.trim() }]
        : [];
    const transcript = evidenceUnits.length > 0
      ? { source, ...(transcriptText?.trim() ? { text: transcriptText.trim() } : {}), segments: evidenceUnits }
      : undefined;
    return { task: toAppTask(task, media), content, media, ...(transcript ? { transcript } : {}), evidenceUnits };
  }

  async list(options: TaskListOptions = {}): Promise<readonly AppTaskRecord[]> {
    const response = await this.#files.listTaskIds();
    const tasks = (await Promise.all(response.taskIds.map((taskId) => this.get(taskId)))).filter((task): task is AppTaskRecord => Boolean(task));
    const filtered = tasks.filter((task) =>
      (options.status === undefined || task.status === options.status) &&
      (options.platform === undefined || task.platform === options.platform) &&
      (options.contentType === undefined || task.contentType === options.contentType),
    ).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return options.limit === undefined ? filtered : filtered.slice(0, Math.max(0, options.limit));
  }

  async listEvents(taskId: string, options: { readonly afterSequence?: number } = {}): Promise<readonly TaskEventRecord[]> {
    const value = await this.#readOptionalText(taskId, "events.jsonl");
    if (!value) return [];
    return value.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const event = eventFromJson(JSON.parse(line));
        return event ? [event] : [];
      } catch {
        return [];
      }
    }).filter((event) => options.afterSequence === undefined || event.sequence > options.afterSequence)
      .sort((left, right) => left.sequence - right.sequence);
  }

  subscribe(taskId: string, listener: TaskEventListener): () => void {
    const listeners = this.#listeners.get(taskId) ?? new Set<TaskEventListener>();
    listeners.add(listener);
    this.#listeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(taskId);
    };
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const tasks = await this.list();
    return tasks
      .filter((task) => task.status === "running")
      .map((task) => ({
        kind: "ingest" as const,
        id: task.id,
        source: "persisted" as const,
        execution: "in-process" as const,
      }));
  }

  async recoverInterruptedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const unfinished = await this.inspectUnfinishedWork();
    const recovered: RuntimeUnfinishedWork[] = [];
    for (const work of unfinished) {
      const task = await this.#readTask(work.id);
      if (!task || task.status !== "running") continue;
      const paths = await this.#artifactStore.initializeTask(task.id);
      const now = currentIso(this.#now);
      await this.#artifactStore.writeJson(paths.task, {
        ...task,
        status: "interrupted",
        interruptedAt: now,
        updatedAt: now,
        issues: [...task.issues, issueForInterrupted()],
      });
      recovered.push(work);
    }
    return recovered;
  }

  async getStartupRecovery(): Promise<TaskRecoveryProjection> {
    const recovered = await this.recoverInterruptedWork();
    return { taskIds: recovered.map((work) => work.id), status: "interrupted" };
  }

  async cancel(_taskId: string): Promise<AppTaskRecord> {
    void _taskId;
    throw taskError("TASK_CANCEL_FAILED", "首版不支持中断正在运行的采集，请等待当前步骤结束或重新提交链接。", "edit_input");
  }

  async retry(_taskId: string): Promise<AppTaskRecord> {
    void _taskId;
    throw taskError("TASK_INTERRUPTED", "请返回首页重新提交链接；首版不会复制或覆盖旧任务。", "edit_input");
  }

  /** Used only by the analysis adapter to keep the task projection current. */
  async setAnalysisStatus(taskId: string, analysisStatus: AppTaskRecord["analysisStatus"]): Promise<void> {
    const task = await this.#readTask(taskId);
    if (!task) throw taskError("TASK_ARTIFACT_MISSING", "未找到内容拆解对应的任务", "view_partial_result");
    const paths = await this.#artifactStore.initializeTask(taskId);
    await this.#artifactStore.writeJson(paths.task, { ...task, analysisStatus, updatedAt: currentIso(this.#now) });
  }

  async #report(event: ProgressEvent): Promise<void> {
    const listeners = this.#listeners.get(event.taskId);
    if (!listeners) return;
    await Promise.all([...listeners].map(async (listener) => { await listener(event); }));
  }

  async #readTask(taskId: string): Promise<TaskRecord | undefined> {
    if (!TASK_ID_PATTERN.test(taskId)) return undefined;
    const value = await this.#readOptionalText(taskId, "task.json");
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as unknown;
      const record = asRecord(parsed);
      if (!record || record.id !== taskId || !isTaskStatus(record.status) || !Array.isArray(record.issues)) return undefined;
      return parsed as TaskRecord;
    } catch {
      throw taskError("TASK_ARTIFACT_MISSING", "本地任务记录无法读取", "view_partial_result");
    }
  }

  async #readRequest(taskId: string): Promise<StoredTaskRequest> {
    const value = await this.#readOptionalText(taskId, TASK_REQUEST_PATH);
    if (!value) throw taskError("TASK_ARTIFACT_MISSING", "任务缺少已保存的安全链接", "edit_input");
    try {
      const parsed = JSON.parse(value) as Partial<StoredTaskRequest>;
      if (typeof parsed.normalizedUrl !== "string" || !parsed.normalizedUrl.startsWith("https://")) throw new TypeError();
      return { normalizedUrl: parsed.normalizedUrl };
    } catch {
      throw taskError("TASK_ARTIFACT_MISSING", "任务安全链接格式无效", "edit_input");
    }
  }

  async #readJson(taskId: string, relativePath: string): Promise<unknown> {
    const value = await this.#readOptionalText(taskId, relativePath);
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  async #readOptionalText(taskId: string, relativePath: string): Promise<string | undefined> {
    const result = await this.#files.readText({ taskId, relativePath });
    return typeof result.value === "string" ? result.value : undefined;
  }

  async #taskMedia(task: TaskRecord): Promise<readonly MediaReference[]> {
    const media: MediaReference[] = [];
    if (task.contentType === "video") {
      const video = await this.#mediaReference(task.id, "media/video.mp4", "video", "下载的视频");
      if (video) media.push(video);
    }
    if (task.contentType === "image_text") {
      const metadata = asRecord(await this.#readJson(task.id, "metadata.json"));
      const images = Array.isArray(metadata?.images) ? metadata.images : [];
      for (let index = 0; index < images.length && index < 100; index += 1) {
        const image = await this.#mediaReference(task.id, `media/images/image-${index}.bin`, "image", `已保存图片 ${index + 1}`);
        if (image) media.push(image);
      }
    }
    return media;
  }

  async #mediaReference(taskId: string, relativePath: string, kind: MediaReference["kind"], displayName: string): Promise<MediaReference | undefined> {
    const result = await this.#files.getUri({ taskId, relativePath });
    if (!result.uri) return undefined;
    return {
      uri: this.#toDisplayUri(result.uri),
      kind,
      origin: "downloaded",
      ...(result.mimeType ? { mimeType: result.mimeType } : {}),
      ...(Number.isFinite(result.sizeBytes) ? { byteLength: result.sizeBytes } : {}),
      displayName,
    };
  }
}
