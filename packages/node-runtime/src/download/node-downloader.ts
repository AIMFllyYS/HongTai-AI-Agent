import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { TaskError, type DownloadProgress, type MediaDownloader, type MediaSource } from "@hongtai/core";
import { fetch, getGlobalDispatcher, RetryAgent, type Dispatcher } from "undici";
import { mediaNetworkError, storageTaskError } from "../errors";

export interface NodeMediaDownloaderOptions {
  readonly maxRetries?: number;
  readonly minRetryDelayMs?: number;
  readonly timeoutMs?: number;
}

const REJECTED_VIDEO_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "text/json",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

function normalizedContentType(value: string | null): string | undefined {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

function validContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function assertDownloadedLength(downloadedBytes: number, totalBytes?: number): void {
  if (downloadedBytes === 0) {
    throw new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体服务器返回了空文件", action: "retry" });
  }
  if (totalBytes !== undefined && downloadedBytes !== totalBytes) {
    throw new TaskError({
      code: "MEDIA_DOWNLOAD_FAILED",
      message: "媒体文件下载长度不完整",
      action: "retry",
      details: { expectedBytes: totalBytes, downloadedBytes },
    });
  }
}

export class NodeMediaDownloader implements MediaDownloader {
  readonly #dispatcher: Dispatcher;
  readonly #timeoutMs: number;

  constructor(options: NodeMediaDownloaderOptions = {}) {
    const minRetryDelayMs = Math.min(3_000, Math.max(0, options.minRetryDelayMs ?? 1_000));
    this.#dispatcher = new RetryAgent(getGlobalDispatcher(), {
      maxRetries: Math.max(0, options.maxRetries ?? 2),
      minTimeout: minRetryDelayMs,
      maxTimeout: 3_000,
      timeoutFactor: 3,
      retryAfter: true,
      methods: ["GET"],
      statusCodes: [429, 500, 502, 503, 504],
      throwOnError: false,
    });
    this.#timeoutMs = options.timeoutMs ?? 600_000;
  }

  async download(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    try {
      await this.#downloadOnce(source, destination, onProgress);
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined);
      throw error instanceof TaskError ? error : mediaNetworkError(error);
    }
  }

  async #downloadOnce(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch (error) {
      throw new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "媒体源地址无效", action: "retry", cause: error });
    }
    if (parsed.protocol !== "https:") throw new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体源不是HTTPS地址", action: "retry" });

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(parsed, {
        dispatcher: this.#dispatcher,
        headers: source.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw mediaNetworkError(error);
    }
    const finalUrl = response.url ? new URL(response.url) : parsed;
    if (finalUrl.protocol !== "https:") throw new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体下载被重定向到非HTTPS地址", action: "retry" });
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new TaskError({
        code: "MEDIA_DOWNLOAD_FAILED",
        message: response.status === 429 ? "媒体服务器请求过于频繁" : "媒体服务器暂时不可用",
        retryable: true,
        action: response.status === 429 ? "wait_and_retry" : "retry",
        details: { httpStatus: response.status },
      });
    }
    if (!response.ok || !response.body) {
      throw new TaskError({ code: response.status === 404 ? "MEDIA_SOURCE_NOT_FOUND" : "MEDIA_DOWNLOAD_FAILED", message: `媒体下载失败：HTTP ${response.status}`, action: "retry", details: { httpStatus: response.status } });
    }
    const contentType = normalizedContentType(response.headers.get("content-type"));
    if (source.kind === "video" && contentType && REJECTED_VIDEO_CONTENT_TYPES.has(contentType)) {
      await response.body.cancel();
      throw new TaskError({
        code: "MEDIA_DOWNLOAD_FAILED",
        message: "媒体服务器返回的不是可下载视频",
        action: "retry",
        details: { contentType },
      });
    }

    try {
      await mkdir(dirname(destination), { recursive: true });
    } catch (error) {
      throw storageTaskError(error, "无法创建媒体目录");
    }
    const totalBytes = validContentLength(response.headers.get("content-length"));
    let file;
    try {
      file = await open(destination, "w");
    } catch (error) {
      throw storageTaskError(error, "无法创建媒体文件");
    }
    let downloadedBytes = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await file.write(value);
        downloadedBytes += value.byteLength;
        await onProgress?.({
          downloadedBytes,
          totalBytes,
          progress: totalBytes && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : undefined,
        });
      }
      assertDownloadedLength(downloadedBytes, totalBytes);
      await onProgress?.({ downloadedBytes, totalBytes, progress: 1 });
    } catch (error) {
      if (error instanceof TaskError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === "ENOSPC" || code === "EACCES" || code === "EPERM") throw storageTaskError(error, "媒体文件写入失败");
      throw mediaNetworkError(error);
    } finally {
      await file.close().catch(() => undefined);
    }
  }
}
