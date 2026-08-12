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
export const APP_RUNTIME_CONTRACT_VERSION = "app-runtime.v2";

export const RUNTIME_WORK_KIND_VALUES = [
  "ingest",
  "content-analysis",
  "diagnosis-report",
  "production-plan",
  "production-render",
  "transient-operation",
] as const;

export type RuntimeWorkKind = typeof RUNTIME_WORK_KIND_VALUES[number];
export type RuntimeWorkExecution = "in-process" | "external-activity";

export interface RuntimeUnfinishedWork {
  readonly kind: RuntimeWorkKind;
  readonly id: string;
  readonly source: "memory" | "persisted";
  readonly execution: RuntimeWorkExecution;
}

export interface RuntimeRecoveryProjection {
  readonly unfinished: readonly RuntimeUnfinishedWork[];
  readonly recovered: readonly RuntimeUnfinishedWork[];
}

export interface RuntimeRecoveryService {
  inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]>;
  recoverInterruptedWork(): Promise<RuntimeRecoveryProjection>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type StructuredGenerationFlow = "diagnosis-report" | "content-analysis";

export type StructuredGenerationModuleId =
  | "visual-observations"
  | "observation-summary"
  | "wellness-recommendations"
  | "safety-limitations"
  | "follow-up-questions"
  | "overview"
  | "hook-drivers"
  | "structure-claims"
  | "style-template"
  | "risks-boundaries";

export type StructuredGenerationModuleStatus = "pending" | "running" | "repairing" | "succeeded" | "failed";

export interface StructuredGenerationModuleV1 {
  readonly moduleId: StructuredGenerationModuleId;
  readonly status: StructuredGenerationModuleStatus;
  /** Present only after this exact module passed Zod and semantic validation. */
  readonly result?: JsonObject;
}

export interface StructuredGenerationThinkingV1 {
  readonly status: "waiting" | "streaming" | "completed";
  readonly text: string;
}

export interface StructuredGenerationProgressV1 {
  readonly schemaVersion: "structured-generation-progress.v1";
  readonly flow: StructuredGenerationFlow;
  readonly phase: "preparing" | "generating" | "validating" | "saving";
  readonly modules: readonly StructuredGenerationModuleV1[];
  /** Runtime-only raw provider reasoning. Services must never persist it. */
  readonly thinking?: StructuredGenerationThinkingV1;
}

export type StructuredGenerationProgressListener = (
  progress: StructuredGenerationProgressV1,
) => void | Promise<void>;

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

/** Native build identity that is safe to display inside the local application. */
export interface AppBuildInfo {
  readonly versionName: string;
  readonly versionCode: number;
}

/** Explicit, narrow access to Android's own application metadata. */
export interface DeviceSettingsService {
  getAppInfo(): Promise<AppBuildInfo>;
}

export type AiCapability = "text" | "vision" | "asr" | "tts";
export type AiAsrTransport = "audio-transcriptions" | "chat-input-audio" | "stepaudio-sse";
/** The native video renderer owns these provider-specific audio protocols. */
export type AiTtsTransport = "mimo-chat-audio" | "stepfun-audio-speech";

/**
 * A verified, provider-owned connection profile. Selecting one never exposes
 * the API key and does not create another credentials store.
 */
export interface AiProviderPreset {
  readonly id: "xiaomi-mimo" | "stepfun";
  readonly label: string;
  readonly baseUrl: string;
  readonly textModel: string;
  readonly visionModel: string;
  readonly asrModel: string;
  readonly asrTransport: AiAsrTransport;
  readonly ttsModel: string;
  readonly ttsTransport: AiTtsTransport;
  readonly ttsVoice: string;
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema: boolean;
}

/**
 * The app deliberately stores exact model IDs rather than asking users to
 * reconstruct vendor-specific audio protocols by hand. StepFun's image
 * endpoint uses a different visual model than its text endpoint, and its
 * preset leaves structured-output flags off so the shared schema parser stays
 * valid for both paths.
 */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = Object.freeze([
  {
    id: "xiaomi-mimo",
    label: "小米 MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    textModel: "mimo-v2.5",
    visionModel: "mimo-v2.5",
    asrModel: "mimo-v2.5-asr",
    asrTransport: "chat-input-audio",
    ttsModel: "mimo-v2.5-tts",
    ttsTransport: "mimo-chat-audio",
    ttsVoice: "冰糖",
    supportsJsonObject: true,
    supportsJsonSchema: true,
  },
  {
    id: "stepfun",
    label: "阶跃星辰",
    baseUrl: "https://api.stepfun.com/v1",
    textModel: "step-3.5-flash",
    visionModel: "step-1o-turbo-vision",
    asrModel: "stepaudio-2.5-asr",
    asrTransport: "stepaudio-sse",
    ttsModel: "stepaudio-2.5-tts",
    ttsTransport: "stepfun-audio-speech",
    ttsVoice: "cixingnansheng",
    supportsJsonObject: false,
    supportsJsonSchema: false,
  },
]);
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
  readonly ttsModel: string | null;
  readonly ttsTransport: AiTtsTransport | null;
  readonly ttsVoice: string | null;
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
  readonly ttsModel?: string | null;
  readonly ttsTransport?: AiTtsTransport | null;
  readonly ttsVoice?: string | null;
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
 * A deliberately narrow invalidation stream for task lists and detail views.
 * It is emitted only after the authoritative task projection has changed; raw
 * download/SSE progress remains on its existing per-task channel.
 */
export type TaskChangeEventV1 =
  | {
      readonly schemaVersion: "task-change.v1";
      readonly type: "upsert";
      readonly task: AppTaskRecord;
    }
  | {
      readonly schemaVersion: "task-change.v1";
      readonly type: "deleted";
      readonly taskId: string;
    };

export type TaskChangeListener = (event: TaskChangeEventV1) => void | Promise<void>;

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

/**
 * Read-only result of Android's one-time startup recovery. It never re-runs
 * recovery from the UI; callers use the IDs only to refresh persisted task
 * projections and offer a manual retry.
 */
export interface TaskRecoveryProjection {
  readonly taskIds: readonly string[];
  readonly status: Extract<TaskStatus, "interrupted">;
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
  subscribeChanges(listener: TaskChangeListener): Unsubscribe;
  /** Reads the native one-time startup recovery projection without replaying it. */
  getStartupRecovery(): Promise<TaskRecoveryProjection>;
  cancel(taskId: string): Promise<AppTaskRecord>;
  /** Creates a new immutable task with a distinct ID and `retryOfTaskId=taskId`. */
  retry(taskId: string): Promise<AppTaskRecord>;
  /** Permanently removes one terminal task and all of its private artifacts. */
  delete(taskId: string): Promise<void>;
}

export interface ContentAnalysisRecord {
  readonly taskId: string;
  readonly status: TaskAnalysisStatus;
  readonly result?: VersionedDocument;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ContentAnalysisStreamEvent =
  | { readonly type: "progress"; readonly taskId: string; readonly progress: StructuredGenerationProgressV1 }
  | { readonly type: "completed"; readonly taskId: string; readonly record: ContentAnalysisRecord }
  | {
      readonly type: "failed";
      readonly taskId: string;
      readonly issue: TaskIssue;
      readonly failedModuleId?: StructuredGenerationModuleId;
      readonly progress: StructuredGenerationProgressV1;
    };

export type ContentAnalysisEventListener = (event: ContentAnalysisStreamEvent) => void | Promise<void>;

export interface AnalysisService {
  get(taskId: string): Promise<ContentAnalysisRecord | undefined>;
  /** Emits only validated semantic modules; raw provider output is never exposed. */
  run(taskId: string, onEvent?: ContentAnalysisEventListener): Promise<ContentAnalysisRecord>;
  /** Selects one local MP4, runs the shared ingest pipeline, then creates the formal analysis. */
  importVideo(onEvent?: ContentAnalysisEventListener): Promise<ContentAnalysisRecord>;
  subscribe(taskId: string, listener: ContentAnalysisEventListener): Unsubscribe;
}

export type ProductionStatus = "draft" | "planning" | "ready" | "rendering" | "succeeded" | "failed";
export type ProductionMode = "montage" | "avatar";
export type ProductionAssetRole = "visual" | "avatar" | "music";

export interface ProductionAsset extends MediaReference {
  readonly id: string;
  readonly role: ProductionAssetRole;
}

export interface ProductionProjectRecord {
  readonly projectId: string;
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  /** Required only for avatar mode and used as the caption source. */
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
  readonly status: ProductionStatus;
  readonly assets: readonly ProductionAsset[];
  readonly plan?: VersionedDocument;
  readonly output?: MediaReference;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProductionEvent =
  | { readonly type: "state"; readonly project: ProductionProjectRecord }
  | { readonly type: "render-progress"; readonly projectId: string; readonly progress: number; readonly message: string };

export interface ProductionService {
  create(input: {
    readonly analysisTaskId: string;
    readonly brief: string;
    readonly targetDurationSeconds: number;
    readonly mode?: ProductionMode;
    readonly avatarScript?: string;
  }): Promise<ProductionProjectRecord>;
  get(projectId: string): Promise<ProductionProjectRecord | undefined>;
  list(): Promise<readonly ProductionProjectRecord[]>;
  /** Opens the system picker and copies selected items into this project's private directory. */
  importAssets(projectId: string): Promise<ProductionProjectRecord>;
  generatePlan(projectId: string): Promise<ProductionProjectRecord>;
  render(projectId: string): Promise<ProductionProjectRecord>;
  /** Removes one imported asset and invalidates any plan and output that referenced it. */
  removeAsset(projectId: string, assetId: string): Promise<ProductionProjectRecord>;
  /** Removes only the rendered output while preserving a valid plan. */
  removeOutput(projectId: string): Promise<ProductionProjectRecord>;
  /** Permanently removes one production project and all owned private artifacts. */
  delete(projectId: string): Promise<void>;
  subscribe(projectId: string, listener: (event: ProductionEvent) => void | Promise<void>): Unsubscribe;
}

export interface ContentTemplateInput {
  readonly name: string;
  readonly summary: string;
  readonly formula: string;
  readonly steps: readonly string[];
  readonly variableSlots: readonly string[];
}

export interface ContentTemplateRecord extends ContentTemplateInput {
  readonly templateId: string;
  readonly sourceTaskId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TemplateService {
  list(): Promise<readonly ContentTemplateRecord[]>;
  get(templateId: string): Promise<ContentTemplateRecord | undefined>;
  createFromAnalysis(taskId: string): Promise<ContentTemplateRecord>;
  create(input: ContentTemplateInput): Promise<ContentTemplateRecord>;
  update(templateId: string, input: ContentTemplateInput): Promise<ContentTemplateRecord>;
  delete(templateId: string): Promise<void>;
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

export type DiagnosisReportStreamEvent =
  | { readonly type: "progress"; readonly sessionId: string; readonly progress: StructuredGenerationProgressV1 }
  | { readonly type: "completed"; readonly sessionId: string; readonly record: DiagnosisReportRecord }
  | {
      readonly type: "failed";
      readonly sessionId: string;
      readonly issue: TaskIssue;
      readonly failedModuleId?: StructuredGenerationModuleId;
      readonly progress: StructuredGenerationProgressV1;
    };

export type DiagnosisReportEventListener = (event: DiagnosisReportStreamEvent) => void | Promise<void>;

export type DiagnosisImageRecovery =
  | { readonly status: "none" }
  | { readonly status: "succeeded"; readonly image: MediaReference }
  | { readonly status: "failed"; readonly issue: TaskIssue };

export interface DiagnosisService {
  /** Uses the active platform runtime to pick and copy one image privately. */
  pickImage(): Promise<MediaReference>;
  /** Uses the platform camera, then copies the completed image into app-private storage. */
  captureImage(): Promise<MediaReference>;
  /** Consumes at most one terminal photo result left by an external Activity/WebView rebuild. */
  consumeImageRecovery(): Promise<DiagnosisImageRecovery>;
  createSession(input: { readonly mode: ObservationMode; readonly image: MediaReference }): Promise<DiagnosisSessionRecord>;
  /** Starts the initial report for a pending session; it never fabricates a completed report. */
  runReport(sessionId: string, onEvent?: DiagnosisReportEventListener): Promise<DiagnosisReportRecord>;
  subscribeReport(sessionId: string, listener: DiagnosisReportEventListener): Unsubscribe;
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
  | "templates"
  | "publish";
export type FeatureCapabilityRegistry = Readonly<Record<AppFeature, FeatureCapability>>;

export interface AppRuntime {
  readonly profile: ProfileService;
  readonly deviceSettings: DeviceSettingsService;
  readonly aiSettings: AiSettingsService;
  readonly tasks: TaskService;
  readonly analysis: AnalysisService;
  readonly diagnosis: DiagnosisService;
  readonly production: ProductionService;
  readonly recovery: RuntimeRecoveryService;
  readonly templates: TemplateService;
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
