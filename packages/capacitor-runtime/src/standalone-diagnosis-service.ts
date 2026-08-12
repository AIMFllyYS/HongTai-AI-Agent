import { DiagnosisFlow, diagnosisReportSchema } from "@hongtai/ai";
import type {
  AiMessage,
  AiProvider,
  AiRunRecord,
  DiagnosisImageInput,
  DiagnosisReportV1,
  DiagnosisRepository,
  DiagnosisSession,
} from "@hongtai/ai";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type {
  DiagnosisMessage,
  DiagnosisImageRecovery,
  DiagnosisReportEventListener,
  DiagnosisReportStreamEvent,
  DiagnosisReportRecord,
  DiagnosisService,
  DiagnosisSessionRecord,
  DiagnosisStreamEvent,
  MediaReference,
  ObservationMode,
  RuntimeUnfinishedWork,
  StructuredGenerationModuleId,
  StructuredGenerationProgressV1,
  TaskIssue,
} from "@hongtai/core";

import { persistedRuntimeWork, runtimeInterruptedIssue } from "./runtime-interruption.js";
import type { RuntimeOperationIdentity, RuntimeOperationRegistry } from "./runtime-operation-registry.js";

const SESSION_PATH = "session.json";
const REPORT_PATH = "report.json";
const MESSAGES_PATH = "messages.json";
const CONTEXT_PATH = "context.txt";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SUPPORTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface StandaloneObservationFilesPlugin {
  ensureObservation(options: { readonly sessionId: string }): Promise<void>;
  writeObservationText(options: {
    readonly sessionId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  readObservationText(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listObservationIds(): Promise<{ readonly sessionIds: readonly string[] }>;
  copyToObservation(options: { readonly sessionId: string; readonly sourceUri: string; readonly relativePath: string }): Promise<{
    readonly uri: string;
    readonly sizeBytes: number;
    readonly mimeType?: string;
  }>;
  getObservationUri(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
}

export interface StandaloneDiagnosisFileMedia {
  pickPhoto(): Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>;
  capturePhoto(): Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>;
  consumePhotoOperation(): Promise<
    | { readonly status: "none" }
    | {
        readonly status: "succeeded";
        readonly origin: "imported" | "captured";
        readonly uri: string;
        readonly mimeType?: string;
        readonly sizeBytes: number;
      }
    | { readonly status: "failed"; readonly code: string }
  >;
}

export interface StandaloneDiagnosisServiceOptions {
  readonly files: StandaloneObservationFilesPlugin;
  readonly fileMedia: StandaloneDiagnosisFileMedia;
  readonly getProvider: () => Promise<AiProvider>;
  readonly toDisplayUri: (nativeUri: string) => string;
  readonly createSessionId?: () => string;
  readonly now?: () => Date;
  readonly operations?: RuntimeOperationRegistry;
}

interface StoredSession {
  readonly sessionId: string;
  readonly reportId: string;
  readonly mode: ObservationMode;
  readonly image: { readonly relativePath: string; readonly mimeType: string; readonly sizeBytes: number };
  readonly reportStatus: DiagnosisSessionRecord["reportStatus"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly issue?: TaskIssue;
}

function taskError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string, action: ConstructorParameters<typeof TaskError>[0]["action"] = "none"): TaskError {
  return new TaskError({ code, message, action });
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function generatedId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return uuid ? `observation-${uuid}` : `observation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validMime(value: string | undefined): string {
  const mime = value?.trim().toLowerCase() ?? "";
  if (!SUPPORTED_IMAGE_MIME.has(mime)) throw taskError("IMAGE_INVALID", "请选择有效的 JPEG、PNG 或 WebP 照片", "select_media");
  return mime;
}

function imageTaskError(nativeCode: string | undefined, cause: unknown): TaskError {
  switch (nativeCode) {
    case "ERR_MEDIA_SELECTION_CANCELLED":
      return new TaskError({ code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择或拍摄图片", action: "select_media", cause });
    case "ERR_MEDIA_SOURCE_MISSING":
      return new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "系统没有返回可读取的图片", action: "select_media", cause });
    case "ERR_PHOTO_CAPTURE_LOST":
    case "ERR_PHOTO_RECOVERY_FAILED":
      return new TaskError({ code: "TASK_INTERRUPTED", message: "图片操作在应用重建后无法恢复，请重新选择或拍摄", action: "select_media", cause });
    case "ERR_MEDIA_READ_FAILED":
      return new TaskError({ code: "MEDIA_READ_FAILED", message: "无法继续读取系统返回的图片", action: "select_media", cause });
    case "ERR_IMAGE_TOO_LARGE":
      return new TaskError({ code: "IMAGE_TOO_LARGE", message: "图片不能超过15MB", action: "select_media", cause });
    case "ERR_IMAGE_INVALID":
      return new TaskError({ code: "IMAGE_INVALID", message: "无法读取或规范化图片", action: "select_media", cause });
    default:
      return new TaskError({ code: "MEDIA_IMPORT_FAILED", message: "图片没有成功导入应用私有目录", action: "select_media", cause });
  }
}

function imageImportError(error: unknown): TaskError {
  if (error instanceof TaskError) return error;
  const nativeCode = typeof record(error)?.code === "string" ? record(error)?.code as string : undefined;
  return imageTaskError(nativeCode, error);
}

function imagePath(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return "image.jpg";
    case "image/png": return "image.png";
    case "image/webp": return "image.webp";
    default: return "image.bin";
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function reportDocument(value: unknown): DiagnosisReportRecord["report"] {
  const parsed = diagnosisReportSchema.safeParse(value);
  return parsed.success ? { schemaVersion: "diagnosis-report.v1", document: JSON.parse(JSON.stringify(parsed.data)) } : undefined;
}

function isStatus(value: unknown): value is StoredSession["reportStatus"] {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed";
}

function asStoredSession(value: unknown, sessionId: string): StoredSession | undefined {
  const item = record(value);
  const image = record(item?.image);
  if (!item || item.sessionId !== sessionId || typeof item.reportId !== "string" || (item.mode !== "tongue" && item.mode !== "face") ||
      !image || typeof image.relativePath !== "string" || typeof image.mimeType !== "string" || typeof image.sizeBytes !== "number" ||
      !isStatus(item.reportStatus) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") return undefined;
  return {
    sessionId,
    reportId: item.reportId,
    mode: item.mode,
    image: { relativePath: image.relativePath, mimeType: image.mimeType, sizeBytes: image.sizeBytes },
    reportStatus: item.reportStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.issue ? { issue: item.issue as TaskIssue } : {}),
  };
}

function issue(error: unknown, fallbackMessage: string): TaskIssue {
  return issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: fallbackMessage, action: "retry" });
}

/**
 * File-backed adapter around the shared DiagnosisFlow. State contains the
 * image's private relative path, while every UI projection is converted to a
 * display URI only at the edge.
 */
export class StandaloneDiagnosisService implements DiagnosisService {
  readonly #files: StandaloneObservationFilesPlugin;
  readonly #fileMedia: StandaloneDiagnosisFileMedia;
  readonly #getProvider: () => Promise<AiProvider>;
  readonly #toDisplayUri: (nativeUri: string) => string;
  readonly #createSessionId: () => string;
  readonly #now: () => Date;
  readonly #operations?: RuntimeOperationRegistry;
  readonly #picked = new Map<string, { readonly nativeUri: string; readonly mimeType: string; readonly sizeBytes: number }>();
  readonly #activeReports = new Map<string, Promise<DiagnosisReportRecord>>();
  readonly #reportListeners = new Map<string, Set<DiagnosisReportEventListener>>();
  readonly #reportSnapshots = new Map<string, StructuredGenerationProgressV1>();

  constructor(options: StandaloneDiagnosisServiceOptions) {
    this.#files = options.files;
    this.#fileMedia = options.fileMedia;
    this.#getProvider = options.getProvider;
    this.#toDisplayUri = options.toDisplayUri;
    this.#createSessionId = options.createSessionId ?? generatedId;
    this.#now = options.now ?? (() => new Date());
    this.#operations = options.operations;
  }

  async pickImage(): Promise<MediaReference> {
    return this.#track(
      { kind: "transient-operation", id: "diagnosis-photo", execution: "external-activity" },
      () => this.#pickedImage(() => this.#fileMedia.pickPhoto(), "imported"),
    );
  }

  async captureImage(): Promise<MediaReference> {
    return this.#track(
      { kind: "transient-operation", id: "diagnosis-photo", execution: "external-activity" },
      () => this.#pickedImage(() => this.#fileMedia.capturePhoto(), "captured"),
    );
  }

  async consumeImageRecovery(): Promise<DiagnosisImageRecovery> {
    let recovered: Awaited<ReturnType<StandaloneDiagnosisFileMedia["consumePhotoOperation"]>>;
    try {
      recovered = await this.#fileMedia.consumePhotoOperation();
    } catch (error) {
      return { status: "failed", issue: issueFromAppError(imageImportError(error)) };
    }
    if (recovered.status === "none") return { status: "none" };
    if (recovered.status === "failed") {
      const cause = { code: recovered.code };
      return { status: "failed", issue: issueFromAppError(imageTaskError(recovered.code, cause)) };
    }
    return { status: "succeeded", image: this.#rememberPicked(recovered, recovered.origin) };
  }

  async createSession(input: { readonly mode: ObservationMode; readonly image: MediaReference }): Promise<DiagnosisSessionRecord> {
    if (input.mode !== "tongue" && input.mode !== "face") throw taskError("IMAGE_INVALID", "请选择舌象或面部其中一种观察方式", "select_media");
    if (!input.image || input.image.kind !== "image") throw taskError("IMAGE_INVALID", "观察会话只能使用一张已导入图片", "select_media");
    const picked = this.#picked.get(input.image.uri);
    if (!picked) throw taskError("IMAGE_INVALID", "图片需要通过本机选择器重新导入", "select_media");
    const sessionId = this.#createSessionId();
    if (!ID_PATTERN.test(sessionId)) throw taskError("IMAGE_INVALID", "本地观察会话标识无效", "select_media");
    await this.#files.ensureObservation({ sessionId });
    const relativePath = imagePath(picked.mimeType);
    const copied = await this.#files.copyToObservation({ sessionId, sourceUri: picked.nativeUri, relativePath });
    const timestamp = nowIso(this.#now);
    const state: StoredSession = {
      sessionId,
      reportId: `report-${sessionId}`,
      mode: input.mode,
      image: { relativePath, mimeType: picked.mimeType, sizeBytes: copied.sizeBytes },
      reportStatus: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#writeSession(state);
    return this.#toUiSession(state, copied.uri);
  }

  runReport(sessionId: string, onEvent?: DiagnosisReportEventListener): Promise<DiagnosisReportRecord> {
    const active = this.#activeReports.get(sessionId);
    if (active) {
      const listener = onEvent ? this.#attachRunReportListener(sessionId, onEvent) : undefined;
      if (listener) void active.finally(() => this.#removeReportListener(sessionId, listener)).catch(() => undefined);
      return active;
    }
    const listener = onEvent ? this.#attachRunReportListener(sessionId, onEvent) : undefined;
    const operation = this.#track(
      { kind: "diagnosis-report", id: sessionId, execution: "in-process" },
      () => this.#runReport(sessionId),
    );
    this.#activeReports.set(sessionId, operation);
    void operation.finally(() => {
      if (this.#activeReports.get(sessionId) === operation) {
        this.#activeReports.delete(sessionId);
        this.#reportSnapshots.delete(sessionId);
      }
      if (listener) this.#removeReportListener(sessionId, listener);
    }).catch(() => undefined);
    return operation;
  }

  subscribeReport(sessionId: string, listener: DiagnosisReportEventListener): () => void {
    this.#addReportListener(sessionId, listener);
    const snapshot = this.#reportSnapshots.get(sessionId);
    if (snapshot) void this.#notifyReportListener(listener, { type: "progress", sessionId, progress: snapshot });
    return () => {
      const listeners = this.#reportListeners.get(sessionId);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#reportListeners.delete(sessionId);
    };
  }

  async #runReport(sessionId: string): Promise<DiagnosisReportRecord> {
    const state = await this.#readSession(sessionId);
    if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话", "select_media");
    const started = await this.#setStatus(state, "running");
    try {
      const flow = new DiagnosisFlow({
        provider: await this.#getProvider(),
        repository: this.#repository(),
        contextWindowTokens: 32_000,
        onProgress: (progress) => {
          this.#reportSnapshots.set(sessionId, progress);
          this.#notifyReport(sessionId, { type: "progress", sessionId, progress });
        },
      });
      await flow.runReport(sessionId);
      const saved = await this.getReport(sessionId);
      if (!saved?.report || saved.status !== "succeeded") throw taskError("STORAGE_WRITE_FAILED", "观察报告没有保存为正式本地文档", "free_storage");
      this.#notifyReport(sessionId, { type: "completed", sessionId, record: saved });
      return saved;
    } catch (error) {
      const failure = issue(error, "观察报告未能完成");
      const current = await this.getReport(sessionId).catch(() => undefined);
      if (current?.status !== "succeeded") {
        await this.#setStatus(started, "failed", failure).catch(() => undefined);
      }
      const progress = this.#reportSnapshots.get(sessionId) ?? this.#emptyReportProgress();
      const failedModuleId = this.#failedReportModuleId(progress);
      this.#notifyReport(sessionId, {
        type: "failed",
        sessionId,
        issue: current?.issue ?? failure,
        ...(failedModuleId ? { failedModuleId } : {}),
        progress,
      });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<DiagnosisSessionRecord | undefined> {
    const state = await this.#readSession(sessionId);
    if (!state) return undefined;
    const image = await this.#files.getObservationUri({ sessionId, relativePath: state.image.relativePath });
    if (!image.uri) return undefined;
    return this.#toUiSession(state, image.uri, image.sizeBytes);
  }

  async listSessions(): Promise<readonly DiagnosisSessionRecord[]> {
    const ids = await this.#files.listObservationIds();
    const sessions = (await Promise.all(ids.sessionIds.map((id) => this.getSession(id)))).filter((session): session is DiagnosisSessionRecord => Boolean(session));
    return sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async getReport(sessionId: string): Promise<DiagnosisReportRecord | undefined> {
    const state = await this.#readSession(sessionId);
    if (!state) return undefined;
    const raw = await this.#files.readObservationText({ sessionId, relativePath: REPORT_PATH });
    const formal = raw.value ? reportDocument(this.#parseJson(raw.value)) : undefined;
    if (state.reportStatus === "succeeded" && !formal) return undefined;
    return this.#toReport(state, formal);
  }

  async inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const { sessionIds } = await this.#files.listObservationIds();
    const unfinished: RuntimeUnfinishedWork[] = [];
    for (const sessionId of sessionIds) {
      const state = await this.#readSession(sessionId);
      if (state?.reportStatus === "running") {
        unfinished.push(persistedRuntimeWork("diagnosis-report", sessionId));
      }
    }
    return unfinished;
  }

  async recoverInterruptedWork(): Promise<readonly RuntimeUnfinishedWork[]> {
    const unfinished = await this.inspectUnfinishedWork();
    const recovered: RuntimeUnfinishedWork[] = [];
    for (const work of unfinished) {
      const state = await this.#readSession(work.id);
      if (!state || state.reportStatus !== "running") continue;
      await this.#setStatus(state, "failed", runtimeInterruptedIssue());
      recovered.push(work);
    }
    return recovered;
  }

  async listMessages(sessionId: string): Promise<readonly DiagnosisMessage[]> {
    const state = await this.#readSession(sessionId);
    if (!state) return [];
    const raw = await this.#files.readObservationText({ sessionId, relativePath: MESSAGES_PATH });
    const values = raw.value ? this.#parseJson(raw.value) : [];
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      const item = record(value);
      if (!item || typeof item.id !== "string" || item.sessionId !== sessionId || (item.role !== "user" && item.role !== "assistant") ||
          typeof item.content !== "string" || (item.status !== "completed" && item.status !== "failed") || typeof item.createdAt !== "string") return [];
      return [{
        id: item.id,
        sessionId,
        role: item.role,
        content: item.content,
        status: item.status,
        ...(item.issue ? { issue: item.issue as TaskIssue } : {}),
        createdAt: item.createdAt,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : item.createdAt,
      }];
    });
  }

  async followUp(sessionId: string, question: string, onEvent?: (event: DiagnosisStreamEvent) => void | Promise<void>): Promise<DiagnosisMessage> {
    return this.#track(
      { kind: "transient-operation", id: `diagnosis-follow-up:${sessionId}`, execution: "in-process" },
      () => this.#followUp(sessionId, question, onEvent),
    );
  }

  async #followUp(sessionId: string, question: string, onEvent?: (event: DiagnosisStreamEvent) => void | Promise<void>): Promise<DiagnosisMessage> {
    if (!question.trim()) throw taskError("INPUT_EMPTY", "追问内容不能为空", "edit_input");
    try {
      const flow = new DiagnosisFlow({
        provider: await this.#getProvider(),
        repository: this.#repository(),
        contextWindowTokens: 32_000,
        onEvent: async (event) => {
          if (event.type === "content_delta") await onEvent?.({ type: "content_delta", delta: event.delta });
        },
      });
      const result = await flow.chat(sessionId, question.trim());
      const messages = await this.listMessages(sessionId);
      const saved = messages.find((message) => message.id === result.id);
      if (!saved) throw taskError("STORAGE_WRITE_FAILED", "追问回复没有保存到本地历史", "free_storage");
      await onEvent?.({ type: "completed", message: saved });
      return saved;
    } catch (error) {
      const failure = issue(error, "追问没有完成");
      await onEvent?.({ type: "failed", issue: failure });
      throw error;
    }
  }

  async #track<T>(operation: RuntimeOperationIdentity, run: () => Promise<T>): Promise<T> {
    return this.#operations ? this.#operations.track(operation, run) : run();
  }

  #addReportListener(sessionId: string, listener: DiagnosisReportEventListener): void {
    const listeners = this.#reportListeners.get(sessionId) ?? new Set<DiagnosisReportEventListener>();
    listeners.add(listener);
    this.#reportListeners.set(sessionId, listeners);
  }

  #attachRunReportListener(sessionId: string, onEvent: DiagnosisReportEventListener): DiagnosisReportEventListener {
    const listener: DiagnosisReportEventListener = (event) => onEvent(event);
    this.#addReportListener(sessionId, listener);
    const snapshot = this.#reportSnapshots.get(sessionId);
    if (snapshot) void this.#notifyReportListener(listener, { type: "progress", sessionId, progress: snapshot });
    return listener;
  }

  #removeReportListener(sessionId: string, listener: DiagnosisReportEventListener): void {
    const listeners = this.#reportListeners.get(sessionId);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#reportListeners.delete(sessionId);
  }

  #notifyReport(sessionId: string, event: DiagnosisReportStreamEvent): void {
    const listeners = this.#reportListeners.get(sessionId);
    if (!listeners) return;
    for (const listener of listeners) void this.#notifyReportListener(listener, event);
  }

  async #notifyReportListener(listener: DiagnosisReportEventListener, event: DiagnosisReportStreamEvent): Promise<void> {
    try {
      await listener(event);
    } catch {
      // Page lifecycle changes cannot affect a persisted formal report.
    }
  }

  #emptyReportProgress(): StructuredGenerationProgressV1 {
    return {
      schemaVersion: "structured-generation-progress.v1",
      flow: "diagnosis-report",
      phase: "preparing",
      modules: (["visual-observations", "observation-summary", "wellness-recommendations", "safety-limitations", "follow-up-questions"] as const)
        .map((moduleId) => ({ moduleId, status: "pending" as const })),
    };
  }

  #failedReportModuleId(progress: StructuredGenerationProgressV1): StructuredGenerationModuleId | undefined {
    return progress.modules.find((module) => module.status === "failed")?.moduleId;
  }

  async #pickedImage(
    pick: () => Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>,
    origin: MediaReference["origin"],
  ): Promise<MediaReference> {
    const raw = await pick().catch((error: unknown) => { throw imageImportError(error); });
    return this.#rememberPicked(raw, origin);
  }

  #rememberPicked(
    raw: { readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number },
    origin: MediaReference["origin"],
  ): MediaReference {
    const mimeType = validMime(raw.mimeType);
    if (!raw.uri || !Number.isFinite(raw.sizeBytes) || raw.sizeBytes <= 0) throw taskError("MEDIA_IMPORT_FAILED", "图片导入没有返回有效的私有文件", "select_media");
    const uri = this.#toDisplayUri(raw.uri);
    this.#picked.set(uri, { nativeUri: raw.uri, mimeType, sizeBytes: raw.sizeBytes });
    return { uri, kind: "image", origin, mimeType, byteLength: raw.sizeBytes, displayName: "已导入图片" };
  }

  #repository(): DiagnosisRepository {
    return {
      createSession: async (mode, image) => {
        const synthetic = await this.#createFromFlow(mode, image);
        return { id: synthetic.sessionId, reportId: `report-${synthetic.sessionId}`, mode, createdAt: synthetic.createdAt, image: { mimeType: synthetic.image.mimeType } };
      },
      getSession: async (sessionId): Promise<DiagnosisSession | undefined> => {
        const state = await this.#readSession(sessionId);
        return state ? { id: state.sessionId, reportId: state.reportId, mode: state.mode, createdAt: state.createdAt, image: { mimeType: state.image.mimeType } } : undefined;
      },
      loadSessionImage: async (sessionId): Promise<DiagnosisImageInput | undefined> => {
        const state = await this.#readSession(sessionId);
        if (!state) return undefined;
        const image = await this.#files.getObservationUri({ sessionId, relativePath: state.image.relativePath });
        return image.uri ? { uri: image.uri, mimeType: state.image.mimeType } : undefined;
      },
      saveReport: async (sessionId, value) => {
        const state = await this.#readSession(sessionId);
        if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话");
        await this.#files.writeObservationText({ sessionId, relativePath: REPORT_PATH, value: JSON.stringify(value), replace: true });
        await this.#setStatus(state, "succeeded");
      },
      getReport: async (sessionId): Promise<DiagnosisReportV1 | undefined> => {
        const raw = await this.#files.readObservationText({ sessionId, relativePath: REPORT_PATH });
        const parsed = raw.value ? diagnosisReportSchema.safeParse(this.#parseJson(raw.value)) : undefined;
        return parsed?.success ? parsed.data : undefined;
      },
      listMessages: async (sessionId): Promise<readonly AiMessage[]> => {
        const state = await this.#readSession(sessionId);
        if (!state) return [];
        return (await this.listMessages(sessionId)).map((message) => ({
          id: message.id,
          sessionId,
          reportId: state.reportId,
          role: message.role,
          content: message.content,
          status: message.status === "failed" ? "failed" : "completed",
          createdAt: message.createdAt,
        }));
      },
      appendMessages: async (sessionId, messages) => {
        const existing = await this.listMessages(sessionId);
        const state = await this.#readSession(sessionId);
        if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话");
        const combined = [...existing, ...messages.map((message) => ({
          id: message.id,
          sessionId,
          role: message.role,
          content: message.content,
          status: message.status,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        }))];
        await this.#files.writeObservationText({ sessionId, relativePath: MESSAGES_PATH, value: JSON.stringify(combined), replace: true });
      },
      getContextSummary: async (sessionId) => (await this.#files.readObservationText({ sessionId, relativePath: CONTEXT_PATH })).value ?? "",
      saveContextSummary: async (sessionId, summary) => {
        await this.#files.writeObservationText({ sessionId, relativePath: CONTEXT_PATH, value: summary, replace: true });
      },
      // Audit prompt/reasoning is not necessary for the demo's presentation
      // contract, so it is intentionally not persisted in app files.
      saveRun: async (_sessionId: string, _run: AiRunRecord) => {
        void _sessionId;
        void _run;
      },
    };
  }

  async #createFromFlow(mode: ObservationMode, image: DiagnosisImageInput): Promise<StoredSession> {
    if (!("uri" in image) || typeof image.uri !== "string") throw taskError("IMAGE_INVALID", "本地观察只接受私有图片引用", "select_media");
    const sessionId = this.#createSessionId();
    await this.#files.ensureObservation({ sessionId });
    const mimeType = validMime(image.mimeType);
    const relativePath = imagePath(mimeType);
    const copied = await this.#files.copyToObservation({ sessionId, sourceUri: image.uri, relativePath });
    const timestamp = nowIso(this.#now);
    const state: StoredSession = {
      sessionId,
      reportId: `report-${sessionId}`,
      mode,
      image: { relativePath, mimeType, sizeBytes: copied.sizeBytes },
      reportStatus: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#writeSession(state);
    return state;
  }

  async #readSession(sessionId: string): Promise<StoredSession | undefined> {
    if (!ID_PATTERN.test(sessionId)) return undefined;
    const raw = await this.#files.readObservationText({ sessionId, relativePath: SESSION_PATH });
    return raw.value ? asStoredSession(this.#parseJson(raw.value), sessionId) : undefined;
  }

  async #writeSession(state: StoredSession): Promise<void> {
    await this.#files.writeObservationText({ sessionId: state.sessionId, relativePath: SESSION_PATH, value: JSON.stringify(state), replace: true });
  }

  async #setStatus(state: StoredSession, reportStatus: StoredSession["reportStatus"], failure?: TaskIssue): Promise<StoredSession> {
    const next: StoredSession = {
      ...state,
      reportStatus,
      updatedAt: nowIso(this.#now),
      ...(failure ? { issue: failure } : {}),
    };
    await this.#writeSession(next);
    return next;
  }

  #toUiSession(state: StoredSession, nativeUri: string, sizeBytes = state.image.sizeBytes, mimeType = state.image.mimeType): DiagnosisSessionRecord {
    return {
      sessionId: state.sessionId,
      mode: state.mode,
      image: {
        uri: this.#toDisplayUri(nativeUri),
        kind: "image",
        origin: "imported",
        mimeType: validMime(mimeType),
        byteLength: sizeBytes,
        displayName: `${state.mode === "tongue" ? "舌象" : "面部"}图片`,
      },
      reportStatus: state.reportStatus,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  #toReport(state: StoredSession, report: DiagnosisReportRecord["report"]): DiagnosisReportRecord {
    return {
      sessionId: state.sessionId,
      status: state.reportStatus,
      ...(report ? { report } : {}),
      ...(state.issue ? { issue: state.issue } : {}),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  #parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
