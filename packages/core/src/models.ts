export type SupportedPlatform = "douyin" | "xiaohongshu" | "bilibili";
export type ContentType = "video" | "image_text" | "unknown";
export type SpeechStatus = "transcribed" | "no_speech" | "failed";

export type ErrorCode =
  | "INPUT_EMPTY" | "INPUT_NO_SUPPORTED_URL" | "INPUT_URL_INVALID" | "INPUT_PLATFORM_UNSUPPORTED"
  | "LINK_NETWORK_FAILED" | "LINK_TIMEOUT" | "LINK_REDIRECT_LIMIT" | "LINK_REDIRECT_INVALID" | "LINK_HTTP_ERROR" | "LINK_EXPIRED"
  | "CONTENT_NOT_FOUND" | "CONTENT_REMOVED" | "CONTENT_PRIVATE_OR_LOGIN_REQUIRED" | "CONTENT_PARSE_FAILED" | "CONTENT_SCHEMA_CHANGED" | "CONTENT_TYPE_UNSUPPORTED"
  | "PLATFORM_API_RATE_LIMITED" | "PLATFORM_API_UNAVAILABLE" | "PLATFORM_API_RESPONSE_INVALID"
  | "MEDIA_SOURCE_NOT_FOUND" | "MEDIA_DOWNLOAD_FAILED" | "MEDIA_DOWNLOAD_TIMEOUT" | "MEDIA_DURATION_EXCEEDED" | "MEDIA_PROBE_FAILED" | "MEDIA_MERGE_FAILED"
  | "AI_NOT_CONFIGURED" | "AI_AUTH_INVALID" | "AI_PERMISSION_DENIED" | "AI_QUOTA_EXHAUSTED" | "AI_RATE_LIMITED" | "AI_NETWORK_FAILED" | "AI_TIMEOUT" | "AI_SERVER_ERROR" | "AI_EMPTY_RESPONSE" | "ASR_PARTIAL_FAILURE" | "TEXT_REWRITE_FAILED"
  | "STORAGE_WRITE_FAILED" | "STORAGE_SPACE_INSUFFICIENT" | "STORAGE_PERMISSION_DENIED"
  | "INTERNAL_UNKNOWN_ERROR";

export type IssueAction = "edit_input" | "retry" | "wait_and_retry" | "check_network" | "configure_ai" | "free_storage" | "view_partial_result" | "none";

export type TaskStage =
  | "detect-platform"
  | "resolve-link"
  | "parse-content"
  | "select-media"
  | "download-media"
  | "obtain-transcript"
  | "save-artifacts";

export type StageStatus = "pending" | "running" | "succeeded" | "degraded" | "failed";
export type TaskStatus = "running" | "succeeded" | "degraded" | "failed";

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
  readonly stage: TaskStage;
  readonly status: StageStatus;
  readonly message: string;
  readonly progress?: number;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly issue?: TaskIssue;
  readonly timestamp: string;
}

export interface IngestRequest {
  readonly input: string;
  readonly outputDirectory?: string;
  readonly maxDurationSeconds?: number;
}

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
  readonly stage: TaskStage;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly action: IssueAction;
  readonly platform?: SupportedPlatform;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
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

export interface TaskRecord {
  readonly id: string;
  readonly sourceUrl: string;
  readonly status: TaskStatus;
  readonly currentStage?: TaskStage;
  readonly platform?: SupportedPlatform;
  readonly contentType?: ContentType;
  readonly speechStatus?: SpeechStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly issues: readonly TaskIssue[];
  readonly paths?: TaskPaths;
}

export interface IngestResult {
  readonly taskId: string;
  readonly status: TaskStatus;
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
