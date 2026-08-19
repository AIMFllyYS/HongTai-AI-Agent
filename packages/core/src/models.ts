export type SupportedPlatform = "douyin" | "xiaohongshu" | "bilibili" | "kuaishou";
export type ContentAnalysisPlatform = SupportedPlatform | "local_upload";
export type TaskSourceKind = "public_link" | "local_video";
export type PlatformSupportLevel = "stable" | "experimental";
export type ContentType = "video" | "image_text" | "unknown";
export type SpeechStatus = "transcribed" | "no_speech" | "failed";

export type NativeLinkDiagnosticPhase = "request" | "connect" | "redirect" | "response" | "decode";
export type NativeLinkDiagnosticErrorClass =
  | "dns"
  | "tls"
  | "connection"
  | "timeout"
  | "redirect_limit"
  | "redirect_invalid"
  | "response_too_large"
  | "response_invalid_encoding"
  | "response_io"
  | "invalid_request";
export type NativeNetworkType = "wifi" | "cellular" | "ethernet" | "vpn" | "offline" | "other" | "unknown";

/** Safe diagnostic projection accepted from the Android page-fetch bridge. */
export interface NativeLinkDiagnosticV1 {
  readonly schemaVersion: "native-link-diagnostic.v1";
  readonly operation: "fetch-text";
  readonly phase: NativeLinkDiagnosticPhase;
  readonly hostname?: string;
  readonly errorClass: NativeLinkDiagnosticErrorClass;
  readonly elapsedMs: number;
  readonly networkType?: NativeNetworkType;
  readonly attempt: number;
  readonly redirectCount: number;
}

export type ErrorCode =
  | "INPUT_EMPTY" | "INPUT_NO_SUPPORTED_URL" | "INPUT_URL_INVALID" | "INPUT_PLATFORM_UNSUPPORTED"
  | "LINK_NETWORK_FAILED" | "LINK_TIMEOUT" | "LINK_REDIRECT_LIMIT" | "LINK_REDIRECT_INVALID" | "LINK_HTTP_ERROR"
  | "CONTENT_NOT_FOUND" | "CONTENT_REMOVED" | "CONTENT_PRIVATE_OR_LOGIN_REQUIRED" | "CONTENT_PARSE_FAILED" | "CONTENT_SCHEMA_CHANGED" | "CONTENT_TYPE_UNSUPPORTED"
  | "PLATFORM_API_RATE_LIMITED" | "PLATFORM_API_UNAVAILABLE" | "PLATFORM_API_RESPONSE_INVALID" | "PLATFORM_RISK_CONTROLLED"
  | "MEDIA_SOURCE_NOT_FOUND" | "MEDIA_SOURCE_INVALID" | "MEDIA_DOWNLOAD_FAILED" | "MEDIA_DOWNLOAD_TIMEOUT" | "MEDIA_DURATION_EXCEEDED" | "MEDIA_PROBE_FAILED" | "MEDIA_MERGE_FAILED" | "MEDIA_RENDER_TIMEOUT" | "MEDIA_ENCODER_UNAVAILABLE" | "MEDIA_DECODE_FAILED" | "MEDIA_RENDER_PIPELINE_FAILED" | "MEDIA_OUTPUT_INVALID" | "MEDIA_EXPORT_FAILED" | "OUTPUT_FINALIZATION_FAILED"
  | "MEDIA_IMPORT_FAILED" | "MEDIA_READ_FAILED" | "MEDIA_SELECTION_CANCELLED"
  | "AI_NOT_CONFIGURED" | "AI_SETTINGS_INVALID" | "AI_SECRET_STORE_FAILED" | "AI_CAPABILITY_PROBE_FAILED" | "AI_AUTH_INVALID" | "AI_PERMISSION_DENIED" | "AI_QUOTA_EXHAUSTED" | "AI_RATE_LIMITED" | "AI_NETWORK_FAILED" | "AI_TIMEOUT" | "AI_SERVER_ERROR" | "AI_EMPTY_RESPONSE" | "AI_STRUCTURED_OUTPUT_INVALID" | "AI_FORMAT_REPAIR_FAILED" | "AI_VISION_UNAVAILABLE" | "AI_CONTEXT_SUMMARY_FAILED" | "AI_SESSION_NOT_FOUND" | "ASR_PARTIAL_FAILURE" | "TEXT_REWRITE_FAILED"
  | "IMAGE_INVALID" | "IMAGE_TOO_LARGE" | "IMAGE_QUALITY_INSUFFICIENT" | "DIAGNOSIS_REPORT_INVALID" | "DIAGNOSIS_FOLLOW_UP_FAILED"
  | "TTS_UNAVAILABLE" | "TTS_SYNTHESIS_FAILED"
  | "PRODUCTION_PLAN_EDIT_INVALID" | "PRODUCTION_PLAN_VERSION_STALE" | "PRODUCTION_DECORATION_MISSING"
  | "PROFILE_SAVE_FAILED" | "TASK_ARTIFACT_MISSING" | "TASK_INTERRUPTED" | "TASK_CANCEL_FAILED"
  | "STORAGE_WRITE_FAILED" | "STORAGE_READ_FAILED" | "STORAGE_SPACE_INSUFFICIENT" | "STORAGE_PERMISSION_DENIED" | "DATABASE_MIGRATION_FAILED" | "DATABASE_KEY_UNAVAILABLE" | "DATABASE_OPEN_FAILED"
  | "APP_RUNTIME_UNAVAILABLE" | "INTERNAL_UNKNOWN_ERROR";

export type IssueAction = "edit_input" | "retry" | "wait_and_retry" | "check_network" | "configure_ai" | "free_storage" | "select_media" | "view_partial_result" | "none";

export const TASK_STAGE_VALUES = [
  "detect-platform",
  "resolve-link",
  "parse-content",
  "select-media",
  "download-media",
  "obtain-transcript",
  "save-artifacts",
] as const;

export type TaskStage = typeof TASK_STAGE_VALUES[number];

export type StageStatus = "pending" | "running" | "succeeded" | "degraded" | "failed";
export const TASK_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type TaskStatus = typeof TASK_STATUS_VALUES[number];

export const ANALYSIS_STATUS_VALUES = ["not_started", "running", "succeeded", "failed"] as const;
export type AnalysisStatus = typeof ANALYSIS_STATUS_VALUES[number];
export type TaskAnalysisStatus = AnalysisStatus;

export interface MediaSource {
  readonly url: string;
  readonly kind: "video" | "audio" | "image";
  readonly quality?: string;
  readonly codec?: string;
  readonly mimeType?: string;
  readonly bitrate?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasWatermark?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SubtitleSource {
  readonly kind: "platform" | "asr" | "description";
  readonly language?: string;
  readonly url?: string;
  readonly text?: string;
}

export interface ResolvedLink {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly body?: string;
}

export interface PlatformContent {
  readonly platform: SupportedPlatform;
  readonly contentType: ContentType;
  readonly id?: string;
  readonly sourceUrl: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly description?: string;
  readonly author?: string;
  readonly coverUrl?: string;
  readonly durationSeconds?: number;
  readonly videos: readonly MediaSource[];
  readonly audios: readonly MediaSource[];
  readonly images: readonly MediaSource[];
  readonly subtitles: readonly SubtitleSource[];
  readonly raw: unknown;
}

export interface ProgressEvent {
  readonly taskId: string;
  /** Per-task, one-based sequence. A progress event is never valid without it. */
  readonly sequence: number;
  readonly stage: TaskStage;
  readonly status: StageStatus;
  readonly message: string;
  readonly progress?: number;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly issue?: TaskIssue;
  readonly timestamp: string;
}

interface IngestRequestOptions {
  /**
   * Optional pre-created local task ID. The application runtime uses this to
   * preserve retry lineage and immutable task history while the CLI may still
   * let the pipeline generate its own ID.
   */
  readonly taskId?: string;
  readonly outputDirectory?: string;
  readonly maxDurationSeconds?: number;
}

export type IngestRequest = IngestRequestOptions & (
  | { readonly input: string; readonly localVideo?: never }
  | { readonly input?: never; readonly taskId: string; readonly localVideo: { readonly displayName: string } }
);

export interface TranscriptSegment {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly status: "succeeded" | "no_speech" | "failed";
  readonly issue?: TaskIssue;
}

export interface TranscriptionResult {
  readonly status: SpeechStatus;
  readonly text: string;
  readonly segments: readonly TranscriptSegment[];
}

export interface TaskIssue {
  readonly code: ErrorCode;
  readonly severity: "warning" | "error";
  /** Omitted for profile, AI configuration, encrypted-storage and other non-ingest operations. */
  readonly stage?: TaskStage;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly action: IssueAction;
  readonly platform?: SupportedPlatform;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly diagnostic?: NativeLinkDiagnosticV1;
}

export interface NormalizedInput {
  readonly rawInput: string;
  readonly extractedText: string;
  readonly normalizedUrl: string;
  readonly platform: SupportedPlatform;
  readonly ignoredSupportedUrlCount: number;
}

export type InputInspection =
  | { readonly ok: true; readonly value: NormalizedInput }
  | { readonly ok: false; readonly issue: TaskIssue };

export interface TaskPaths {
  readonly root: string;
  readonly task: string;
  readonly log: string;
  readonly metadata: string;
  readonly rawResponse: string;
  readonly rawPage: string;
  readonly video: string;
  readonly videoPart: string;
  readonly audioPart: string;
  readonly audio: string;
  readonly imageDirectory: string;
  readonly contentText: string;
  readonly segmentDirectory: string;
  readonly transcript: string;
  readonly transcriptJson: string;
  readonly draft: string;
}

/**
 * A storage-implementation-neutral media locator. `uri` may be an app-private
 * content URI, a Capacitor file URI, or a Node filesystem URI; UI code never
 * needs to infer the underlying platform from it.
 */
export interface MediaReference {
  readonly uri: string;
  readonly kind: "video" | "audio" | "image" | "document";
  readonly origin: "downloaded" | "imported" | "captured";
  readonly mimeType?: string;
  readonly displayName?: string;
  readonly byteLength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
}

export interface TaskRecord {
  readonly id: string;
  readonly sourceUrl: string;
  /** Historical records without this field are interpreted as public-link tasks. */
  readonly sourceKind?: TaskSourceKind;
  readonly status: TaskStatus;
  readonly currentStage?: TaskStage;
  readonly platform?: SupportedPlatform;
  readonly contentType?: ContentType;
  readonly speechStatus?: SpeechStatus;
  /** Kept separate from TaskStage so content analysis never becomes an eighth ingest stage. */
  readonly analysisStatus?: TaskAnalysisStatus;
  /** A retry is a new task that keeps a non-destructive link to its source task. */
  readonly retryOfTaskId?: string;
  readonly cancelRequestedAt?: string;
  readonly cancelledAt?: string;
  readonly interruptedAt?: string;
  readonly media?: readonly MediaReference[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly issues: readonly TaskIssue[];
  readonly paths?: TaskPaths;
}

export interface IngestResult {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly sourceKind?: TaskSourceKind;
  readonly platform?: SupportedPlatform;
  readonly contentType?: ContentType;
  readonly speechStatus?: SpeechStatus;
  readonly videoPath?: string;
  readonly transcriptPath?: string;
  readonly draftPath?: string;
  readonly imagePaths?: readonly string[];
  readonly contentTextPath?: string;
  readonly issues: readonly TaskIssue[];
}
