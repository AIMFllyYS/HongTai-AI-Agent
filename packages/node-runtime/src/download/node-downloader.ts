import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TaskError, type DownloadProgress, type MediaDownloader, type MediaSource } from "@hongtai/core";
import { fetch, getGlobalDispatcher, RetryAgent, type Dispatcher } from "undici";
import { mediaNetworkError, storageTaskError } from "../errors";

export type MediaDownloadFetch = (
  input: URL,
  init?: Parameters<typeof fetch>[1],
) => Promise<{
  readonly url: string;
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: {
    cancel(): void | Promise<void>;
    getReader(): ReadableStreamDefaultReader<Uint8Array>;
  } | null;
}>;

export interface NodeMediaDownloaderOptions {
  readonly maxRetries?: number;
  readonly minRetryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly fetch?: MediaDownloadFetch;
  readonly mkdir?: typeof mkdir;
  readonly openFile?: typeof open;
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

function downloadPartPath(destination: string): string {
  return join(dirname(destination), `.${basename(destination)}.${randomUUID()}.part`);
}

type MoveFile = (from: string, to: string) => Promise<void>;

export async function replaceDownloadedFile(
  temporary: string,
  destination: string,
  moveFile: MoveFile = rename,
): Promise<void> {
  try {
    await moveFile(temporary, destination);
    return;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
  }
  const backup = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.bak`);
  await moveFile(destination, backup);
  try {
    await moveFile(temporary, destination);
  } catch (error) {
    try {
      await moveFile(backup, destination);
    } catch (rollbackError) {
      if (rollbackError instanceof Error) rollbackError.cause = error;
      throw rollbackError;
    }
    throw error;
  }
  await rm(backup, { force: true }).catch(() => undefined);
}

export class NodeMediaDownloader implements MediaDownloader {
  readonly #dispatcher: Dispatcher;
  readonly #timeoutMs: number;
  readonly #fetch: MediaDownloadFetch;
  readonly #mkdir: typeof mkdir;
  readonly #open: typeof open;

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
    this.#fetch = options.fetch ?? fetch;
    this.#mkdir = options.mkdir ?? mkdir;
    this.#open = options.openFile ?? open;
  }

  async download(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    const temporary = downloadPartPath(destination);
    try {
      await this.#downloadOnce(source, destination, temporary, onProgress);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error instanceof TaskError ? error : mediaNetworkError(error);
    }
  }

  async #downloadOnce(
    source: MediaSource,
    destination: string,
    temporary: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch (error) {
      throw new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "媒体源地址无效", action: "retry", cause: error });
    }
    if (parsed.protocol !== "https:") throw new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体源不是HTTPS地址", action: "retry" });

    let response: Awaited<ReturnType<MediaDownloadFetch>>;
    try {
      response = await this.#fetch(parsed, {
        dispatcher: this.#dispatcher,
        headers: source.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw mediaNetworkError(error);
    }
    let consumed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const finalUrl = response.url ? new URL(response.url) : parsed;
      if (finalUrl.protocol !== "https:") throw new TaskError({ code: "MEDIA_DOWNLOAD_FAILED", message: "媒体下载被重定向到非HTTPS地址", action: "retry" });
      if (response.status === 429 || response.status >= 500) {
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
        throw new TaskError({
          code: "MEDIA_DOWNLOAD_FAILED",
          message: "媒体服务器返回的不是可下载视频",
          action: "retry",
          details: { contentType },
        });
      }

      try {
        await this.#mkdir(dirname(destination), { recursive: true });
      } catch (error) {
        throw storageTaskError(error, "无法创建媒体目录");
      }
      const totalBytes = validContentLength(response.headers.get("content-length"));
      let file;
      try {
        file = await this.#open(temporary, "w");
      } catch (error) {
        throw storageTaskError(error, "无法创建媒体文件");
      }
      let downloadedBytes = 0;
      try {
        reader = response.body.getReader();
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
        consumed = true;
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
      try {
        await replaceDownloadedFile(temporary, destination);
      } catch (error) {
        throw storageTaskError(error, "无法创建媒体文件");
      }
    } finally {
      if (!consumed) {
        if (reader) await reader.cancel().catch(() => undefined);
        else await Promise.resolve(response.body?.cancel()).catch(() => undefined);
      }
    }
  }
}
