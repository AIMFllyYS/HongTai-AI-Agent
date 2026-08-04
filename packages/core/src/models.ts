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

export interface MediaSource {
  readonly url: string;
  readonly kind: "video" | "audio" | "image";
  readonly quality?: string;
  readonly mimeType?: string;
  readonly hasWatermark?: boolean;
}

export interface SubtitleSource {
  readonly kind: "platform" | "asr" | "description";
  readonly language?: string;
  readonly url?: string;
  readonly text?: string;
}

export interface PlatformContent {
  readonly platform: SupportedPlatform;
  readonly sourceUrl: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly description?: string;
  readonly author?: string;
  readonly coverUrl?: string;
  readonly videos: readonly MediaSource[];
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
}

export interface IngestRequest {
  readonly url: string;
  readonly outputDirectory?: string;
}

