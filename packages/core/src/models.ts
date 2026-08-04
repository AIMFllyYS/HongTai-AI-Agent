export type SupportedPlatform = "douyin" | "xiaohongshu" | "bilibili";

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
  readonly timestamp: string;
}

export interface IngestRequest {
  readonly url: string;
  readonly outputDirectory?: string;
  readonly maxDurationSeconds?: number;
}

export interface TranscriptSegment {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly status: "succeeded" | "failed";
  readonly error?: string;
}

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
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
  readonly warnings: readonly string[];
  readonly paths?: TaskPaths;
}

export interface IngestResult {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly platform?: SupportedPlatform;
  readonly videoPath?: string;
  readonly transcriptPath?: string;
  readonly draftPath?: string;
  readonly warnings: readonly string[];
  readonly error?: string;
}

