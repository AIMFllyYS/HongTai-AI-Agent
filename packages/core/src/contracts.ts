import type {
  IngestRequest,
  PlatformContent,
  ProgressEvent,
  SupportedPlatform,
} from "./models";

export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  matches(url: string): boolean;
  parse(request: IngestRequest): Promise<PlatformContent>;
}

export interface MediaDownloader {
  download(sourceUrl: string, destination: string): Promise<void>;
}

export interface MediaTranscriber {
  transcribe(mediaPath: string): Promise<{
    readonly text: string;
    readonly srt?: string;
    readonly segments?: readonly unknown[];
  }>;
}

export interface ArtifactStore {
  createTaskDirectory(taskId: string): Promise<string>;
  writeJson(path: string, value: unknown): Promise<void>;
  writeText(path: string, value: string): Promise<void>;
}

export interface ProgressReporter {
  report(event: ProgressEvent): void | Promise<void>;
}

