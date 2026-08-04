import type {
  IngestRequest,
  MediaSource,
  PlatformContent,
  ProgressEvent,
  ResolvedLink,
  SupportedPlatform,
  TaskPaths,
  TranscriptSegment,
} from "./models";

export interface HttpRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpClient {
  get(request: HttpRequest): Promise<HttpResponse>;
}

export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  matches(url: string): boolean;
  resolve(url: string, http: HttpClient): Promise<ResolvedLink>;
  parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent>;
}

export interface DownloadProgress {
  readonly downloadedBytes: number;
  readonly totalBytes?: number;
  readonly progress?: number;
}

export interface MediaDownloader {
  download(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void>;
}

export interface MediaTools {
  merge(videoPath: string, audioPath: string, outputPath: string): Promise<void>;
  probeDuration(mediaPath: string): Promise<number>;
  extractAudio(videoPath: string, audioPath: string): Promise<void>;
  splitAudio(audioPath: string, outputDirectory: string, segmentSeconds: number): Promise<readonly string[]>;
}

export interface MediaTranscriber {
  transcribe(
    segmentPaths: readonly string[],
    segmentSeconds: number,
    onSegment?: (segment: TranscriptSegment, completed: number, total: number) => void | Promise<void>,
  ): Promise<readonly TranscriptSegment[]>;
}

export interface TextRewriter {
  rewrite(transcript: string): Promise<string>;
}

export interface ArtifactStore {
  initializeTask(taskId: string, outputDirectory?: string): Promise<TaskPaths>;
  writeJson(path: string, value: unknown): Promise<void>;
  writeText(path: string, value: string): Promise<void>;
  appendText(path: string, value: string): Promise<void>;
  imagePath(paths: TaskPaths, index: number, source: MediaSource): string;
}

export interface ProgressReporter {
  report(event: ProgressEvent): void | Promise<void>;
}

export interface IngestPipelineDependencies {
  readonly adapters: readonly PlatformAdapter[];
  readonly http: HttpClient;
  readonly downloader: MediaDownloader;
  readonly mediaTools: MediaTools;
  readonly transcriber?: MediaTranscriber;
  readonly rewriter?: TextRewriter;
  readonly store: ArtifactStore;
  readonly reporter: ProgressReporter;
}

export type { IngestRequest };
