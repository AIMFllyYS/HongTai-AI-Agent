import { IngestPipeline, TaskError, inspectInput, isTerminalTaskStatus, platformForHost, safeUrlForDisplay } from "@hongtai/core";
import type {
  AppTaskRecord,
  CancellableTask,
  HttpClient,
  IngestPipelineDependencies,
  LinkedRecordDeleteOptions,
  MediaDownloader,
  MediaReference,
  MediaTools,
  PlatformAdapter,
  ProgressEvent,
  TaskCreateRequest,
  TaskChangeEventV1,
  TaskChangeListener,
  TaskDetailRecord,
  TaskEventListener,
  TaskEventRecord,
  TaskIssue,
  TaskListOptions,
  TaskRecord,
  TaskRecoveryProjection,
  RuntimeUnfinishedWork,
  TaskService,
} from "@hongtai/core";

import { NativeTaskFiles } from "./thin-task-files.js";
import type { LocalTaskFilesPlugin } from "./thin-task-files.js";
import type { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import {
  asRecord,
  eventFromJson,
  isTaskStatus,
  projectTaskDetail,
  projectTaskMedia,
  TASK_ID_PATTERN,
  toAppTask,
} from "./standalone-task-detail-projection.js";
import { failQueuedSnapshot, settleAfterPipeline } from "./standalone-task-ingest-settlement.js";
import {
  consumeTaskVideoRecovery,
  persistImportedVideo,
  videoImportError,
  type StandaloneTaskVideoPicker,
  type TaskVideoRecovery,
} from "./standalone-task-video-recovery.js";

export type { StandaloneTaskVideoPicker, TaskVideoRecovery };

const TASK_REQUEST_PATH = "request.json";

const BILIBILI_REPLAY_QUERY_KEYS = new Set(["aid", "p"]);

/**
 * Keep only non-secret input needed to replay a public-link task.
 * Platform share URLs often carry tracking, session, or signature parameters;
 * those must stay in memory and never enter the private task snapshot.
 * Bilibili's public `aid` and `p` parameters are the only supported replay
 * parameters that affect which public work item/page is selected.
 */
function persistableTaskUrl(normalizedUrl: string): string {
  try {
    const url = new URL(normalizedUrl);
    const platform = platformForHost(url.hostname);
    const retained = new URLSearchParams();
    if (platform === "bilibili") {
      for (const key of BILIBILI_REPLAY_QUERY_KEYS) {
        const value = url.searchParams.get(key);
        if (value && /^[1-9]\d*$/.test(value)) retained.set(key, value);
      }
    }
    url.search = retained.toString();
    url.hash = "";
    return url.toString();
  } catch {
    return safeUrlForDisplay(normalizedUrl);
  }
}

export interface StandaloneTaskFilesPlugin extends LocalTaskFilesPlugin {
  readText(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  exists(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly exists: boolean }>;
  listTaskIds(): Promise<{ readonly taskIds: readonly string[] }>;
  deleteTask(options: { readonly taskId: string; readonly keepRelativePaths?: readonly string[] }): Promise<void>;
  getUri(options: { readonly taskId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
}

/** Optional native frame capture used to backfill a video task's persisted first frame. */
export interface StandaloneTaskMediaCapturePort {
  captureFrame?(options: { readonly taskId: string }): Promise<unknown>;
}

export interface StandaloneTaskServiceOptions {
  readonly files: StandaloneTaskFilesPlugin;
  readonly fileMedia?: StandaloneTaskVideoPicker;
  readonly adapters: readonly PlatformAdapter[];
  readonly http: HttpClient;
  readonly downloader: MediaDownloader;
  readonly mediaTools: MediaTools;
  readonly media?: StandaloneTaskMediaCapturePort;
  readonly transcriber?: IngestPipelineDependencies["transcriber"];
  readonly rewriter?: IngestPipelineDependencies["rewriter"];
  readonly toDisplayUri: (nativeUri: string) => string;
  readonly createTaskId?: () => string;
  readonly now?: () => Date;
  readonly operations?: RuntimeOperationRegistry;
}

type StoredTaskRequest =
  | { readonly kind: "public_link"; readonly normalizedUrl: string }
  | { readonly kind: "local_video"; readonly displayName: string };

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

function issueForInterrupted(sourceKind: TaskRecord["sourceKind"]): TaskIssue {
  const localVideo = sourceKind === "local_video";
  return {
    code: "TASK_INTERRUPTED",
    severity: "warning",
    userMessage: localVideo
      ? "应用上次退出时本地视频处理尚未完成，请重新选择本地视频。"
      : "应用上次退出时任务尚未完成，请重新提交链接。",
    retryable: false,
    action: localVideo ? "select_media" : "edit_input",
  };
}

/**
 * 组合根注入的模板级联端：拆解与模板是同一内容，删除任务必须联动删除其派生模板。
 * deleteRecord 只删模板记录，不再次触发任务侧级联，避免双向递归。
 */
export interface LinkedTemplateDeletion {
  listForTask(taskId: string): Promise<readonly string[]>;
  deleteRecord(templateId: string): Promise<void>;
}

/**
 * File-backed UI service. It delegates execution entirely to the existing
 * IngestPipeline; this class only persists/reads safe task projections and
 * fans out pipeline progress to the current page.
 */
export class StandaloneTaskService implements TaskService {
  readonly #files: StandaloneTaskFilesPlugin;
  readonly #artifactStore: NativeTaskFiles;
  readonly #fileMedia: StandaloneTaskVideoPicker | undefined;
  readonly #adapters: readonly PlatformAdapter[];
  readonly #http: HttpClient;
  readonly #downloader: MediaDownloader;
  readonly #mediaTools: MediaTools;
  readonly #media: StandaloneTaskMediaCapturePort | undefined;
  readonly #transcriber: IngestPipelineDependencies["transcriber"];
  readonly #rewriter: IngestPipelineDependencies["rewriter"];
  readonly #toDisplayUri: (nativeUri: string) => string;
  readonly #createTaskId: () => string;
  readonly #now: () => Date;
  readonly #operations?: RuntimeOperationRegistry;
  readonly #active = new Map<string, CancellableTask>();
  readonly #deletions = new Map<string, Promise<void>>();
  readonly #listeners = new Map<string, Set<TaskEventListener>>();
  readonly #changeListeners = new Set<TaskChangeListener>();
  readonly #thumbnailCaptures = new Map<string, Promise<void>>();
  readonly #thumbnailFailures = new Set<string>();
  #linkedTemplates?: LinkedTemplateDeletion;

  constructor(options: StandaloneTaskServiceOptions) {
    this.#files = options.files;
    this.#artifactStore = new NativeTaskFiles(options.files);
    this.#fileMedia = options.fileMedia;
    this.#adapters = options.adapters;
    this.#http = options.http;
    this.#downloader = options.downloader;
    this.#mediaTools = options.mediaTools;
    this.#media = options.media;
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
    const persistedUrl = persistableTaskUrl(inspection.value.normalizedUrl);
    const task: TaskRecord = {
      id: taskId,
      sourceUrl: persistedUrl,
      sourceKind: "public_link",
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
      this.#artifactStore.writeJson(`task://${taskId}/${TASK_REQUEST_PATH}`, { kind: "public_link", normalizedUrl: persistedUrl } satisfies StoredTaskRequest),
    ]);
    const projection = toAppTask(task);
    await this.#emitChange({ schemaVersion: "task-change.v1", type: "upsert", task: projection });
    return projection;
  }

  async importVideo(): Promise<AppTaskRecord> {
    const fileMedia = this.#fileMedia;
    if (!fileMedia) throw taskError("APP_RUNTIME_UNAVAILABLE", "本地视频选择器尚未加载", "select_media");
    const taskId = this.#createTaskId();
    if (!TASK_ID_PATTERN.test(taskId)) throw taskError("MEDIA_IMPORT_FAILED", "本地任务标识无效", "select_media");
    try {
      // Opening an external picker is not yet a task. Defer the task snapshot
      // until Android has returned a real private MP4, so cancellation or an
      // Activity lifecycle interruption cannot leave a visible empty task.
      const selectVideo = () => fileMedia.pickVideo({ taskId });
      const selected = this.#operations
        ? await this.#operations.track({ kind: "transient-operation", id: `task-video:${taskId}`, execution: "external-activity" }, selectVideo)
        : await selectVideo();
      return await this.#persistImportedVideo(taskId, selected);
    } catch (error) {
      await this.#files.deleteTask({ taskId }).catch(() => undefined);
      throw videoImportError(error);
    }
  }

  async consumeVideoRecovery(): Promise<TaskVideoRecovery> {
    return consumeTaskVideoRecovery(
      this.#fileMedia,
      (taskId, selected) => this.#persistImportedVideo(taskId, selected),
      async (taskId) => { await this.#files.deleteTask({ taskId }); },
    );
  }

  async #persistImportedVideo(taskId: string, selected: {
    readonly uri: string;
    readonly mimeType: "video/mp4";
    readonly displayName: string;
    readonly sizeBytes: number;
    readonly durationSeconds: number;
  }): Promise<AppTaskRecord> {
    return persistImportedVideo(taskId, selected, {
      artifactStore: this.#artifactStore,
      toDisplayUri: this.#toDisplayUri,
      now: this.#now,
      emitChange: (event) => this.#emitChange(event),
    });
  }

  async start(taskId: string): Promise<CancellableTask> {
    const active = this.#active.get(taskId);
    if (active) return active;
    const execute = () => this.#startIngest(taskId);
    const completion = this.#operations
      ? this.#operations.track({ kind: "ingest", id: taskId, execution: "in-process" }, execute)
      : execute();
    const cancellable: CancellableTask = {
      taskId,
      completion,
      cancel: async () => { throw taskError("TASK_CANCEL_FAILED", "首版不在任务执行中断路径中写入第二套状态机。", "edit_input"); },
    };
    this.#active.set(taskId, cancellable);
    void completion.finally(() => {
      if (this.#active.get(taskId) === cancellable) this.#active.delete(taskId);
    }).catch(() => undefined);
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
    return projectTaskDetail(task, media, metadata, transcriptText, transcriptInfo, contentText);
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

  subscribeChanges(listener: TaskChangeListener): () => void {
    this.#changeListeners.add(listener);
    return () => { this.#changeListeners.delete(listener); };
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const tasks = await this.list();
    return tasks
      .filter((task) => task.status === "running" || (task.status === "queued" && task.sourceKind === "local_video"))
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
      if (!task || (task.status !== "running" && !(task.status === "queued" && task.sourceKind === "local_video"))) continue;
      const paths = await this.#artifactStore.initializeTask(task.id);
      const now = currentIso(this.#now);
      const updated: TaskRecord = {
        ...task,
        status: "interrupted",
        interruptedAt: now,
        updatedAt: now,
        issues: [...task.issues, issueForInterrupted(task.sourceKind)],
      };
      await this.#artifactStore.writeJson(paths.task, updated);
      await this.#emitChange({
        schemaVersion: "task-change.v1",
        type: "upsert",
        task: toAppTask(updated, await this.#taskMedia(updated)),
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

  async delete(taskId: string, options?: LinkedRecordDeleteOptions): Promise<void> {
    const existing = this.#deletions.get(taskId);
    if (existing) return existing;
    const operation = this.#deleteTerminalTask(taskId, options).finally(() => this.#deletions.delete(taskId));
    this.#deletions.set(taskId, operation);
    return operation;
  }

  /** 组合根装配后注入模板级联端；拆解与模板是同一内容，删除必须双向联动。 */
  attachLinkedDeletion(linked: LinkedTemplateDeletion): void {
    this.#linkedTemplates = linked;
  }

  async #startIngest(taskId: string): Promise<AppTaskRecord> {
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
    const pipelineRequest = request.kind === "local_video"
      ? { taskId, localVideo: { displayName: request.displayName } } as const
      : { input: request.normalizedUrl, taskId } as const;
    let pipelineIssues: readonly TaskIssue[] = [];
    let runError: unknown;
    try {
      const result = await pipeline.run(pipelineRequest);
      pipelineIssues = result.issues;
    } catch (error) {
      runError = error;
    }
    return settleAfterPipeline(taskId, pipelineIssues, runError, {
      readTask: (id) => this.#readTask(id),
      taskMedia: (item) => this.#taskMedia(item),
      failQueuedSnapshot: (item, issues) => this.#failQueuedSnapshot(item, issues),
    });
  }

  /** Used only by the analysis adapter to keep the task projection current. */
  async setAnalysisStatus(taskId: string, analysisStatus: AppTaskRecord["analysisStatus"]): Promise<void> {
    const task = await this.#readTask(taskId);
    if (!task) throw taskError("TASK_ARTIFACT_MISSING", "未找到内容拆解对应的任务", "view_partial_result");
    const paths = await this.#artifactStore.initializeTask(taskId);
    const updated: TaskRecord = { ...task, analysisStatus, updatedAt: currentIso(this.#now) };
    await this.#artifactStore.writeJson(paths.task, updated);
    await this.#emitChange({
      schemaVersion: "task-change.v1",
      type: "upsert",
      task: toAppTask(updated, await this.#taskMedia(updated)),
    });
  }

  async #failQueuedSnapshot(task: TaskRecord, issues: readonly TaskIssue[]): Promise<AppTaskRecord> {
    return failQueuedSnapshot(task, issues, {
      now: this.#now,
      artifactStore: this.#artifactStore,
      taskMedia: (item) => this.#taskMedia(item),
      emitChange: (event) => this.#emitChange(event),
    });
  }

  async #report(event: ProgressEvent): Promise<void> {
    const listeners = this.#listeners.get(event.taskId);
    if (listeners) {
      await Promise.allSettled([...listeners].map(async (listener) => { await listener(event); }));
    }
    const lifecycleChanged = event.sequence === 1 ||
      event.status === "failed" ||
      (event.stage === "save-artifacts" && event.status === "succeeded");
    if (!lifecycleChanged) return;
    try {
      const task = await this.get(event.taskId);
      if (task && (task.status === "running" || isTerminalTaskStatus(task.status))) {
        await this.#emitChange({ schemaVersion: "task-change.v1", type: "upsert", task });
      }
    } catch {
      // A view notification is best-effort and can never change a persisted
      // pipeline result. The next explicit read/app-resume remains the fallback.
    }
  }

  async #emitChange(event: TaskChangeEventV1): Promise<void> {
    await Promise.allSettled([...this.#changeListeners].map(async (listener) => { await listener(event); }));
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
      const parsed = JSON.parse(value) as Readonly<Record<string, unknown>>;
      if (parsed.kind === "local_video") {
        if (typeof parsed.displayName !== "string" || !parsed.displayName.trim()) throw new TypeError();
        return { kind: "local_video", displayName: parsed.displayName.trim() };
      }
      const normalizedUrl = parsed.normalizedUrl;
      if (typeof normalizedUrl !== "string" || !normalizedUrl.startsWith("https://")) throw new TypeError();
      return { kind: "public_link", normalizedUrl };
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
    const media = await projectTaskMedia(task, this.#files, this.#toDisplayUri, (taskId, relativePath) => this.#readJson(taskId, relativePath));
    return this.#backfillVideoThumbnail(task, media);
  }

  /**
   * The persisted first frame is a regenerable derivative. When a video task
   * has its video but no `media/thumbnail.jpg` yet, one single-flight native
   * capture runs on the read path and the media is resolved once more. A
   * failure is remembered for this process and never retried; reading always
   * falls back to the un-thumbnailed media and never throws.
   */
  async #backfillVideoThumbnail(task: TaskRecord, media: readonly MediaReference[]): Promise<readonly MediaReference[]> {
    const captureFrame = this.#media?.captureFrame;
    if (!captureFrame || task.contentType !== "video") return media;
    if (!media.some((item) => item.kind === "video") || media.some((item) => item.kind === "image")) return media;
    if (this.#thumbnailFailures.has(task.id)) return media;
    const inFlight = this.#thumbnailCaptures.get(task.id) ?? this.#captureThumbnail(captureFrame, task.id);
    await inFlight;
    if (this.#thumbnailFailures.has(task.id)) return media;
    return projectTaskMedia(task, this.#files, this.#toDisplayUri, (taskId, relativePath) => this.#readJson(taskId, relativePath));
  }

  #captureThumbnail(captureFrame: (options: { readonly taskId: string }) => Promise<unknown>, taskId: string): Promise<void> {
    const capture = (async () => {
      try {
        await captureFrame({ taskId });
      } catch {
        this.#thumbnailFailures.add(taskId);
      }
    })();
    this.#thumbnailCaptures.set(taskId, capture);
    void capture.finally(() => {
      if (this.#thumbnailCaptures.get(taskId) === capture) this.#thumbnailCaptures.delete(taskId);
    });
    return capture;
  }

  async #deleteTerminalTask(taskId: string, options?: LinkedRecordDeleteOptions): Promise<void> {
    if (this.#active.has(taskId)) throw taskError("TASK_INTERRUPTED", "任务正在处理中，尚未完成，不能删除", "wait_and_retry");
    const task = await this.#readTask(taskId);
    if (!task) throw taskError("TASK_ARTIFACT_MISSING", "未找到要删除的本地任务", "none");
    if (!isTerminalTaskStatus(task.status)) {
      throw taskError("TASK_INTERRUPTED", "任务尚未完成，不能删除", "wait_and_retry");
    }
    // 双向联动：先删任务文件，再删全部派生模板；模板侧失败会留下可重试的悬挂模板，不伪造成功。
    // keepLocalVideo 只保留 media/video.mp4，任务记录与其余产物一并移除，列表自然不再出现该任务。
    const linkedTemplateIds = this.#linkedTemplates ? await this.#linkedTemplates.listForTask(taskId) : [];
    await this.#files.deleteTask({
      taskId,
      ...(options?.keepLocalVideo ? { keepRelativePaths: ["media/video.mp4"] as const } : {}),
    });
    for (const templateId of linkedTemplateIds) {
      await this.#linkedTemplates?.deleteRecord(templateId);
    }
    this.#listeners.delete(taskId);
    await this.#emitChange({ schemaVersion: "task-change.v1", type: "deleted", taskId });
  }
}
