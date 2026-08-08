import { TaskError } from "@hongtai/core";
import type {
  DownloadProgress,
  HttpClient,
  HttpPostRequest,
  HttpRequest,
  HttpResponse,
  MediaDownloader,
  MediaSource,
  MediaTools,
} from "@hongtai/core";

import { mappedNativeLinkError } from "./native-link-errors.js";
import { parseTaskPath } from "./thin-task-files.js";

export interface NativeTextFetchPort {
  fetchText(options: {
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly maxRedirects?: number;
    readonly timeoutMs?: number;
    readonly maxAttempts?: number;
  }): Promise<{
    readonly finalUrl: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }>;
}

export type NativeDownloadArtifact =
  | { readonly kind: "image"; readonly index: number }
  | { readonly kind: "video" }
  | { readonly kind: "videoPart" }
  | { readonly kind: "audio" };

export interface NativeDownloadPort {
  download(options: {
    readonly taskId: string;
    readonly sourceUrl: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly artifact: NativeDownloadArtifact;
  }): Promise<{
    readonly uri: string;
    readonly sizeBytes: number;
    readonly mimeType?: string;
  }>;
}

export interface NativeDownloadProgressEvent {
  readonly taskId: string;
  readonly artifact: NativeDownloadArtifact;
  readonly downloadedBytes: number;
  readonly totalBytes?: number;
  readonly progress?: number;
}

export interface NativeDownloadListenerHandle {
  remove(): Promise<void>;
}

export interface NativeDownloadProgressPort {
  addListener(
    eventName: "downloadProgress",
    listener: (event: NativeDownloadProgressEvent) => void,
  ): Promise<NativeDownloadListenerHandle> | NativeDownloadListenerHandle;
}

export interface NativeTaskMediaFilesPort {
  getUri(options: { readonly taskId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
  copyPrivateFile(options: {
    readonly taskId: string;
    readonly sourceUri: string;
    readonly relativePath: string;
  }): Promise<void>;
}

export interface NativeMediaPort {
  remuxVideo(options: { readonly taskId: string; readonly videoUri: string; readonly audioUri?: string }): Promise<{
    readonly uri: string;
    readonly sizeBytes: number;
    readonly mimeType: string;
    readonly hasAudio: boolean;
  }>;
  probe(options: { readonly uri: string }): Promise<{ readonly durationMs?: number }>;
  extractPcmWav(options: { readonly taskId: string; readonly sourceUri: string }): Promise<{
    readonly uri: string;
    readonly sizeBytes: number;
    readonly sampleRateHz: number;
    readonly channelCount: number;
  }>;
  segmentPcmWav(options: { readonly taskId: string; readonly sourceUri: string; readonly maxSegmentDurationMs: number }): Promise<{
    readonly sourceDurationMs: number;
    readonly segments: readonly {
      readonly uri: string;
      readonly sizeBytes: number;
      readonly durationMs: number;
      readonly sampleRateHz: number;
      readonly channelCount: number;
    }[];
  }>;
}

export interface NativeIngestPortsOptions {
  readonly network: NativeTextFetchPort & NativeDownloadPort;
  readonly downloadProgress?: NativeDownloadProgressPort;
  readonly files: NativeTaskMediaFilesPort;
  readonly media: NativeMediaPort;
}

function mediaError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string): TaskError {
  return new TaskError({ code, message, action: "view_partial_result" });
}

function downloadArtifact(source: MediaSource, destination: string): { readonly taskId: string; readonly artifact: NativeDownloadArtifact } {
  const { taskId, relativePath } = parseTaskPath(destination);
  if (relativePath === "media/video.mp4" && source.kind === "video") return { taskId, artifact: { kind: "video" } };
  if (relativePath === "media/video-source.bin" && source.kind === "video") return { taskId, artifact: { kind: "videoPart" } };
  if (relativePath === "media/audio-source.bin" && source.kind === "audio") return { taskId, artifact: { kind: "audio" } };
  const image = /^media\/images\/image-(\d+)\.bin$/.exec(relativePath);
  if (image && source.kind === "image") {
    const index = Number.parseInt(image[1] ?? "", 10);
    if (Number.isInteger(index) && index >= 0 && index <= 99) return { taskId, artifact: { kind: "image", index } };
  }
  throw mediaError("MEDIA_DOWNLOAD_FAILED", "本地媒体目标与已解析资源类型不匹配");
}

function sameDownloadArtifact(left: NativeDownloadArtifact, right: NativeDownloadArtifact): boolean {
  return left.kind === right.kind && (left.kind !== "image" || (right.kind === "image" && left.index === right.index));
}

/**
 * Adapter-only implementation of the core I/O contracts. The shared pipeline
 * retains all platform parsing and seven-stage orchestration.
 */
export class NativeIngestPorts {
  readonly #network: NativeIngestPortsOptions["network"];
  readonly #downloadProgress?: NativeDownloadProgressPort;
  readonly #files: NativeIngestPortsOptions["files"];
  readonly #media: NativeIngestPortsOptions["media"];

  readonly http: HttpClient;
  readonly downloader: MediaDownloader;
  readonly mediaTools: MediaTools;

  constructor(options: NativeIngestPortsOptions) {
    this.#network = options.network;
    this.#downloadProgress = options.downloadProgress;
    this.#files = options.files;
    this.#media = options.media;
    this.http = {
      get: (request) => this.#fetch("GET", request),
      post: (request) => this.#fetch("POST", request),
    };
    this.downloader = { download: (source, destination, onProgress) => this.#download(source, destination, onProgress) };
    this.mediaTools = {
      merge: (videoPath, audioPath, outputPath) => this.#merge(videoPath, audioPath, outputPath),
      probeDuration: (mediaPath) => this.#probeDuration(mediaPath),
      extractAudio: (videoPath, audioPath) => this.#extractAudio(videoPath, audioPath),
      splitAudio: (audioPath, _outputDirectory, segmentSeconds) => this.#splitAudio(audioPath, segmentSeconds),
    };
  }

  async #fetch(method: "GET" | "POST", request: HttpRequest | HttpPostRequest): Promise<HttpResponse> {
    const body = method === "POST" ? (request as HttpPostRequest).body : undefined;
    try {
      const result = await this.#network.fetchText({
        method,
        url: request.url,
        headers: request.headers,
        ...(body === undefined ? {} : { body }),
        maxRedirects: request.maxRedirects,
        timeoutMs: request.timeoutMs,
        maxAttempts: request.maxAttempts,
      });
      return { url: result.finalUrl, status: result.status, headers: result.headers, body: result.body };
    } catch (error) {
      throw mappedNativeLinkError(error) ?? error;
    }
  }

  async #download(source: MediaSource, destination: string, onProgress?: (progress: DownloadProgress) => void | Promise<void>): Promise<void> {
    const destinationInfo = downloadArtifact(source, destination);
    let progressQueue = Promise.resolve();
    const listener = this.#downloadProgress && onProgress
      ? await Promise.resolve(this.#downloadProgress.addListener("downloadProgress", (event) => {
        if (event.taskId !== destinationInfo.taskId || !sameDownloadArtifact(event.artifact, destinationInfo.artifact)) return;
        progressQueue = progressQueue.then(() => onProgress({
          downloadedBytes: event.downloadedBytes,
          ...(event.totalBytes === undefined ? {} : { totalBytes: event.totalBytes }),
          ...(event.progress === undefined ? {} : { progress: event.progress }),
        }));
      }))
      : undefined;
    try {
      const result = await this.#network.download({
        taskId: destinationInfo.taskId,
        sourceUrl: source.url,
        artifact: destinationInfo.artifact,
        headers: source.headers,
      });
      await progressQueue;
      if (!result.uri || !Number.isFinite(result.sizeBytes) || result.sizeBytes < 0) {
        throw mediaError("MEDIA_DOWNLOAD_FAILED", "原生下载没有返回已保存的私有媒体");
      }
      await onProgress?.({ downloadedBytes: result.sizeBytes, totalBytes: result.sizeBytes, progress: 1 });
    } finally {
      await listener?.remove();
    }
  }

  async #merge(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    const video = parseTaskPath(videoPath);
    const audio = parseTaskPath(audioPath);
    const output = parseTaskPath(outputPath);
    if (video.taskId !== audio.taskId || video.taskId !== output.taskId || output.relativePath !== "media/video.mp4") {
      throw mediaError("MEDIA_MERGE_FAILED", "本地视频合成目标无效");
    }
    const [videoUri, audioUri] = await Promise.all([this.#privateUri(video), this.#privateUri(audio)]);
    const remuxed = await this.#media.remuxVideo({ taskId: video.taskId, videoUri, audioUri });
    if (!remuxed.uri) throw mediaError("MEDIA_MERGE_FAILED", "本地视频合成没有返回私有文件");
    await this.#files.copyPrivateFile({ taskId: output.taskId, sourceUri: remuxed.uri, relativePath: output.relativePath });
  }

  async #probeDuration(mediaPath: string): Promise<number> {
    const uri = await this.#privateUri(parseTaskPath(mediaPath));
    const result = await this.#media.probe({ uri });
    if (!Number.isFinite(result.durationMs) || (result.durationMs ?? 0) < 0) {
      throw mediaError("MEDIA_PROBE_FAILED", "无法读取本地媒体时长");
    }
    return result.durationMs! / 1_000;
  }

  async #extractAudio(videoPath: string, audioPath: string): Promise<void> {
    const video = parseTaskPath(videoPath);
    const output = parseTaskPath(audioPath);
    if (video.taskId !== output.taskId || output.relativePath !== "media/audio.wav") {
      throw mediaError("MEDIA_PROBE_FAILED", "本地转写音频目标无效");
    }
    const sourceUri = await this.#privateUri(video);
    const extracted = await this.#media.extractPcmWav({ taskId: video.taskId, sourceUri });
    if (!extracted.uri) throw mediaError("MEDIA_PROBE_FAILED", "无法提取本地转写音频");
    await this.#files.copyPrivateFile({ taskId: output.taskId, sourceUri: extracted.uri, relativePath: output.relativePath });
  }

  async #splitAudio(audioPath: string, segmentSeconds: number): Promise<readonly string[]> {
    const audio = parseTaskPath(audioPath);
    if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) {
      throw mediaError("MEDIA_PROBE_FAILED", "本地转写分段时长无效");
    }
    const sourceUri = await this.#privateUri(audio);
    const segmented = await this.#media.segmentPcmWav({
      taskId: audio.taskId,
      sourceUri,
      maxSegmentDurationMs: Math.round(segmentSeconds * 1_000),
    });
    if (!Array.isArray(segmented.segments) || segmented.segments.some((segment) => !segment.uri)) {
      throw mediaError("MEDIA_PROBE_FAILED", "本地转写分段结果无效");
    }
    return segmented.segments.map((segment) => segment.uri);
  }

  async #privateUri(path: ReturnType<typeof parseTaskPath>): Promise<string> {
    const result = await this.#files.getUri(path);
    if (!result.uri) throw mediaError("TASK_ARTIFACT_MISSING", "本地任务产物不存在");
    return result.uri;
  }
}
