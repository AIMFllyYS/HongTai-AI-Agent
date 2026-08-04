import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { DownloadProgress, MediaDownloader, MediaSource } from "@hongtai/core";

export class NodeMediaDownloader implements MediaDownloader {
  async download(
    source: MediaSource,
    destination: string,
    onProgress?: (progress: DownloadProgress) => void | Promise<void>,
  ): Promise<void> {
    const parsed = new URL(source.url);
    if (parsed.protocol !== "https:") throw new Error("媒体源不是HTTPS地址");
    await mkdir(dirname(destination), { recursive: true });
    const response = await fetch(parsed, {
      headers: source.headers,
      redirect: "follow",
      signal: AbortSignal.timeout(600_000),
    });
    if (new URL(response.url).protocol !== "https:") throw new Error("媒体下载被重定向到非HTTPS地址");
    if (!response.ok || !response.body) {
      throw new Error(`视频下载失败：HTTP ${response.status}`);
    }

    const totalHeader = response.headers.get("content-length");
    const totalBytes = totalHeader ? Number(totalHeader) : undefined;
    const file = await open(destination, "w");
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
      await file.close();
      await rm(destination, { force: true });
      throw error;
    }
    await file.close();
  }
}
