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
  DiagnosisReportRecord,
  DiagnosisService,
  DiagnosisSessionRecord,
  DiagnosisStreamEvent,
  MediaReference,
  ObservationMode,
  TaskIssue,
} from "@hongtai/core";

const SESSION_PATH = "session.json";
const REPORT_PATH = "report.json";
const MESSAGES_PATH = "messages.json";
const CONTEXT_PATH = "context.txt";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]*$/;

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
}

export interface StandaloneDiagnosisServiceOptions {
  readonly files: StandaloneObservationFilesPlugin;
  readonly fileMedia: StandaloneDiagnosisFileMedia;
  readonly getProvider: () => Promise<AiProvider>;
  readonly toDisplayUri: (nativeUri: string) => string;
  readonly createSessionId?: () => string;
  readonly now?: () => Date;
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
  if (!IMAGE_MIME.test(mime) || mime === "image/svg+xml") throw taskError("IMAGE_INVALID", "请选择有效的照片文件", "select_media");
  return mime;
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
  readonly #picked = new Map<string, { readonly nativeUri: string; readonly mimeType: string; readonly sizeBytes: number }>();

  constructor(options: StandaloneDiagnosisServiceOptions) {
    this.#files = options.files;
    this.#fileMedia = options.fileMedia;
    this.#getProvider = options.getProvider;
    this.#toDisplayUri = options.toDisplayUri;
    this.#createSessionId = options.createSessionId ?? generatedId;
    this.#now = options.now ?? (() => new Date());
  }

  async pickImage(): Promise<MediaReference> {
    return this.#pickedImage(() => this.#fileMedia.pickPhoto(), "imported");
  }

  async captureImage(): Promise<MediaReference> {
    return this.#pickedImage(() => this.#fileMedia.capturePhoto(), "captured");
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

  async runReport(sessionId: string): Promise<DiagnosisReportRecord> {
    const state = await this.#readSession(sessionId);
    if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话", "select_media");
    const started = await this.#setStatus(state, "running");
    try {
      const flow = new DiagnosisFlow({ provider: await this.#getProvider(), repository: this.#repository(), contextWindowTokens: 32_000 });
      await flow.runReport(sessionId);
      const saved = await this.getReport(sessionId);
      if (!saved?.report || saved.status !== "succeeded") throw taskError("STORAGE_WRITE_FAILED", "观察报告没有保存为正式本地文档", "free_storage");
      return saved;
    } catch (error) {
      const current = await this.getReport(sessionId).catch(() => undefined);
      if (current?.status !== "succeeded") {
        const failed = await this.#setStatus(started, "failed", issue(error, "观察报告未能完成")).catch(() => undefined);
        if (failed) return this.#toReport(failed, undefined);
      }
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

  async #pickedImage(
    pick: () => Promise<{ readonly uri: string; readonly mimeType?: string; readonly sizeBytes: number }>,
    origin: MediaReference["origin"],
  ): Promise<MediaReference> {
    const raw = await pick();
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
