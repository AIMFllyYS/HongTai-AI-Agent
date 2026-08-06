import type {
  ContentType,
  ErrorCode,
  InputInspection,
  MediaReference,
  ProgressEvent,
  SupportedPlatform,
  TaskAnalysisStatus,
  TaskIssue,
  TaskRecord,
  TaskStage,
  TaskStatus,
} from "./models";

/** Versioned boundary between the presentation layer and local application services. */
export const APP_RUNTIME_CONTRACT_VERSION = "app-runtime.v1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export interface VersionedDocument {
  readonly schemaVersion: string;
  readonly document: JsonObject;
}

export interface LocalProfile {
  readonly localProfileId: string;
  readonly remoteAccountId: string | null;
  readonly displayName: string;
  readonly avatarUri: string | null;
  readonly businessName: string | null;
  readonly industry: string | null;
  readonly businessTags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileUpdate {
  readonly displayName?: string;
  readonly avatarUri?: string | null;
  readonly businessName?: string | null;
  readonly industry?: string | null;
  readonly businessTags?: readonly string[];
}

export interface ProfileService {
  get(): Promise<LocalProfile | undefined>;
  update(input: ProfileUpdate): Promise<LocalProfile>;
  /** Uses the active platform runtime to copy an avatar into app-private storage. */
  pickAvatar(): Promise<MediaReference>;
}

export type AiCapability = "text" | "vision" | "asr";
export type AiAsrTransport = "audio-transcriptions" | "chat-input-audio";
export type AiProbeStatus = "succeeded" | "failed";

/**
 * Safe to render and persist in the encrypted database. It deliberately has no
 * API key field; the key is write-only through AiSettingsService.
 */
export interface PublicAiConnectionConfig {
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly textModel: string | null;
  readonly visionModel: string | null;
  readonly asrModel: string | null;
  readonly asrTransport: AiAsrTransport;
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema: boolean;
  readonly hasApiKey: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AiConnectionPublicInput {
  readonly baseUrl: string;
  readonly textModel?: string | null;
  readonly visionModel?: string | null;
  readonly asrModel?: string | null;
  readonly asrTransport: AiAsrTransport;
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema: boolean;
}

export interface AiCapabilityProbeResult {
  readonly capability: AiCapability;
  readonly status: AiProbeStatus;
  readonly checkedAt: string;
  readonly model: string | null;
  readonly issue?: TaskIssue;
}

export interface AiSettingsService {
  getPublic(): Promise<PublicAiConnectionConfig | undefined>;
  save(input: AiConnectionPublicInput): Promise<PublicAiConnectionConfig>;
  /** The key is written to platform secure storage and is never returned by this interface. */
  replaceApiKey(apiKey: string): Promise<void>;
  probe(capability: AiCapability): Promise<AiCapabilityProbeResult>;
  /** Each capability keeps its own most recent probe result. */
  getProbeResults(): Promise<readonly AiCapabilityProbeResult[]>;
}

export interface TaskCreateRequest {
  readonly input: string;
  readonly media?: readonly MediaReference[];
}

export interface TaskListOptions {
  readonly status?: TaskStatus;
  readonly platform?: SupportedPlatform;
  readonly contentType?: ContentType;
  readonly limit?: number;
}

export interface PersistedProgressEvent extends ProgressEvent {
  readonly sequence: number;
}

export interface TaskLifecycleEvent {
  readonly kind: "task-status";
  readonly taskId: string;
  readonly sequence: number;
  readonly taskStatus: TaskStatus;
  readonly currentStage?: TaskStage;
  readonly message: string;
  readonly issue?: TaskIssue;
  readonly timestamp: string;
}

export type TaskEventRecord = PersistedProgressEvent | TaskLifecycleEvent;
/**
 * Storage assigns the sequence inside the same transaction that inserts the
 * event. Callers may never choose one, which prevents duplicate or reordered
 * events after process recovery.
 */
export type TaskEventAppend = Omit<PersistedProgressEvent, "sequence"> | Omit<TaskLifecycleEvent, "sequence">;
export type TaskEventListener = (event: TaskEventRecord) => void | Promise<void>;
export type Unsubscribe = () => void;

/**
 * UI-safe task projection. Node task paths are intentionally absent: pages use
 * MediaReference values that resolve through the active platform runtime.
 */
export interface AppTaskRecord extends Omit<TaskRecord, "paths" | "analysisStatus" | "media"> {
  readonly analysisStatus: TaskAnalysisStatus;
  readonly media: readonly MediaReference[];
}

/**
 * Safe projection for the detail view. Every optional value originates from a
 * persisted task artifact; an absent value is intentionally rendered as an
 * empty state rather than replaced with a fixture or a fabricated metric.
 */
export interface TaskDetailRecord {
  readonly task: AppTaskRecord;
  readonly content: TaskContentDetail;
  readonly media: readonly MediaReference[];
  readonly transcript?: TaskTranscriptDetail;
  readonly imageText?: TaskImageTextDetail;
  readonly evidenceUnits: readonly TaskEvidenceUnit[];
}

export interface TaskContentDetail {
  readonly title?: string;
  readonly description?: string;
  readonly author?: string;
  /** Display-safe canonical URL: no query, hash, signature, or credential. */
  readonly canonicalUrl?: string;
  readonly durationSeconds?: number;
  readonly cover?: MediaReference;
}

export interface TaskEvidenceUnit {
  readonly id: string;
  readonly source: "transcript" | "image_text";
  readonly text: string;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
}

export interface TaskTranscriptDetail {
  readonly source: "asr" | "description";
  readonly text?: string;
  readonly segments: readonly TaskEvidenceUnit[];
}

export interface TaskImageTextDetail {
  readonly text?: string;
  readonly images: readonly MediaReference[];
  readonly paragraphs: readonly TaskEvidenceUnit[];
}

export interface TaskRepository {
  create(task: TaskRecord): Promise<void>;
  get(taskId: string): Promise<TaskRecord | undefined>;
  list(options?: TaskListOptions): Promise<readonly TaskRecord[]>;
  save(task: TaskRecord): Promise<void>;
  /** Atomically assigns `lastSequence + 1` and inserts an immutable event. */
  appendEvent(event: TaskEventAppend): Promise<TaskEventRecord>;
  listEvents(taskId: string, options?: { readonly afterSequence?: number }): Promise<readonly TaskEventRecord[]>;
}

export interface CancellableTask {
  readonly taskId: string;
  readonly completion: Promise<AppTaskRecord>;
  cancel(): Promise<void>;
}

export interface TaskService {
  inspectInput(input: string): InputInspection;
  create(input: TaskCreateRequest): Promise<AppTaskRecord>;
  start(taskId: string): Promise<CancellableTask>;
  get(taskId: string): Promise<AppTaskRecord | undefined>;
  getDetail(taskId: string): Promise<TaskDetailRecord | undefined>;
  list(options?: TaskListOptions): Promise<readonly AppTaskRecord[]>;
  listEvents(taskId: string, options?: { readonly afterSequence?: number }): Promise<readonly TaskEventRecord[]>;
  subscribe(taskId: string, listener: TaskEventListener): Unsubscribe;
  cancel(taskId: string): Promise<AppTaskRecord>;
  /** Creates a new immutable task with a distinct ID and `retryOfTaskId=taskId`. */
  retry(taskId: string): Promise<AppTaskRecord>;
}

export interface ContentAnalysisRecord {
  readonly taskId: string;
  readonly status: TaskAnalysisStatus;
  readonly result?: VersionedDocument;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisService {
  get(taskId: string): Promise<ContentAnalysisRecord | undefined>;
  run(taskId: string): Promise<ContentAnalysisRecord>;
}

export type ObservationMode = "tongue" | "face";
export type DiagnosisReportStatus = "pending" | "running" | "succeeded" | "failed";

export interface DiagnosisSessionRecord {
  readonly sessionId: string;
  readonly mode: ObservationMode;
  readonly image: MediaReference;
  readonly reportStatus: DiagnosisReportStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DiagnosisReportRecord {
  readonly sessionId: string;
  readonly status: DiagnosisReportStatus;
  readonly report?: VersionedDocument;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DiagnosisMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "streaming" | "completed" | "failed";
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DiagnosisStreamEvent =
  | { readonly type: "content_delta"; readonly delta: string }
  | { readonly type: "completed"; readonly message: DiagnosisMessage }
  | { readonly type: "failed"; readonly issue: TaskIssue };

export interface DiagnosisService {
  /** Uses the active platform runtime to pick and copy one image privately. */
  pickImage(): Promise<MediaReference>;
  createSession(input: { readonly mode: ObservationMode; readonly image: MediaReference }): Promise<DiagnosisSessionRecord>;
  /** Starts the initial report for a pending session; it never fabricates a completed report. */
  runReport(sessionId: string): Promise<DiagnosisReportRecord>;
  getSession(sessionId: string): Promise<DiagnosisSessionRecord | undefined>;
  /** Ordered by most recent change, with no image bytes or API reasoning exposed. */
  listSessions(): Promise<readonly DiagnosisSessionRecord[]>;
  getReport(sessionId: string): Promise<DiagnosisReportRecord | undefined>;
  listMessages(sessionId: string): Promise<readonly DiagnosisMessage[]>;
  followUp(
    sessionId: string,
    question: string,
    onEvent?: (event: DiagnosisStreamEvent) => void | Promise<void>,
  ): Promise<DiagnosisMessage>;
}

export const FEATURE_CAPABILITY_VALUES = ["available", "planned"] as const;
export type FeatureCapability = typeof FEATURE_CAPABILITY_VALUES[number];
export type AppFeature =
  | "profile"
  | "aiSettings"
  | "ingest"
  | "contentAnalysis"
  | "diagnosis"
  | "create"
  | "assets"
  | "publish";
export type FeatureCapabilityRegistry = Readonly<Record<AppFeature, FeatureCapability>>;

export interface AppRuntime {
  readonly profile: ProfileService;
  readonly aiSettings: AiSettingsService;
  readonly tasks: TaskService;
  readonly analysis: AnalysisService;
  readonly diagnosis: DiagnosisService;
  readonly features: FeatureCapabilityRegistry;
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status !== "queued" && status !== "running";
}

/** Stable UI-facing error boundary: presentation maps only these values to actions. */
export type TaskIssueDisplayAction = Extract<
  import("./models").IssueAction,
  "retry" | "wait_and_retry" | "configure_ai" | "free_storage" | "select_media" | "view_partial_result" | "edit_input" | "check_network" | "none"
>;

export interface TaskIssuePresentation {
  readonly code: ErrorCode;
  readonly action: TaskIssueDisplayAction;
}

export function taskIssuePresentation(issue: Pick<TaskIssue, "code" | "action">): TaskIssuePresentation {
  return { code: issue.code, action: issue.action };
}
