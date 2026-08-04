import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { TaskError, type DownloadProgress, type MediaDownloader, type MediaSource } from "@hongtai/core";
import { mediaNetworkError, storageTaskError } from "../errors";

export interface NodeMediaDownloaderOptions {
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}

export class NodeMediaDownloader implements MediaDownloader {
  readonly #retryDelaysMs: readonly number[];
  readonly #timeoutMs: number;

  constructor(options: NodeMediaDownloaderOptions = {}) {
    this.#retryDelaysMs = options.retryDelaysMs ?? [0, 1_000, 3_000];
    this.#timeoutMs = options.timeoutMs ?? 600_000;
  }

  async download(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    let lastError: TaskError | undefined;
    for (let attempt = 0; attempt < this.#retryDelaysMs.length; attempt += 1) {
      const delay = this.#retryDelaysMs[attempt] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await this.#downloadOnce(source, destination, onProgress);
        return;
      } catch (error) {
        await rm(destination, { force: true }).catch(() => undefined);
        lastError = error instanceof TaskError ? error : mediaNetworkError(error);
        if (!lastError.retryable) throw lastError;
      }
    }
    throw lastError ?? new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体下载失败", action: "retry" });
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

    let response: Response;
    try {
      response = await fetch(parsed, {
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

    try {
      await mkdir(dirname(destination), { recursive: true });
    } catch (error) {
      throw storageTaskError(error, "无法创建媒体目录");
    }
    const totalHeader = response.headers.get("content-length");
    const totalBytes = totalHeader ? Number(totalHeader) : undefined;
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
      await onProgress?.({ downloadedBytes, totalBytes, progress: 1 });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "ENOSPC" || code === "EACCES" || code === "EPERM") throw storageTaskError(error, "媒体文件写入失败");
      throw mediaNetworkError(error);
    } finally {
      await file.close().catch(() => undefined);
    }
  }
}
