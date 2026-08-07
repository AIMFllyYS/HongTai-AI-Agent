import assert from "node:assert/strict";
import test from "node:test";

import { NativeIngestPorts } from "./thin-ingest-ports.js";

test("NativeIngestPorts preserves platform HTTP limits and maps a video source slot without overwriting the final video", async () => {
  const fetches: unknown[] = [];
  const downloads: unknown[] = [];
  const downloadProgress: unknown[] = [];
  const copies: unknown[] = [];
  let progressListener: ((event: {
    readonly taskId: string;
    readonly artifact: { readonly kind: "videoPart" };
    readonly downloadedBytes: number;
    readonly totalBytes?: number;
    readonly progress?: number;
  }) => void) | undefined;
  const ports = new NativeIngestPorts({
    network: {
      fetchText: async (input: unknown) => {
        fetches.push(input);
        return { finalUrl: "https://www.kuaishou.com/short-video/123", status: 200, headers: { "content-type": "text/html" }, body: "<html />" };
      },
      download: async (input: unknown) => {
        downloads.push(input);
        progressListener?.({ taskId: "task-1", artifact: { kind: "videoPart" }, downloadedBytes: 12, totalBytes: 24, progress: 0.5 });
        return { uri: "file:///private/tasks/task-1/media/video-source.bin", sizeBytes: 24, mimeType: "video/mp4" };
      },
    },
    downloadProgress: {
      addListener: async (_eventName, listener) => {
        progressListener = listener as typeof progressListener;
        return { remove: async () => { progressListener = undefined; } };
      },
    },
    files: {
      getUri: async () => ({ uri: "file:///private/tasks/task-1/media/video-source.bin" }),
      copyPrivateFile: async (input: unknown) => { copies.push(input); },
    },
    media: {
      remuxVideo: async () => ({ uri: "file:///private/tasks/task-1/media/remux/final.mp4", sizeBytes: 31, mimeType: "video/mp4", hasAudio: true }),
      probe: async () => ({ durationMs: 42_000 }),
      extractPcmWav: async () => ({ uri: "file:///private/tasks/task-1/media/pcm/audio.wav", sizeBytes: 9, sampleRateHz: 8_000, channelCount: 1 }),
      segmentPcmWav: async () => ({ sourceDurationMs: 42_000, segments: [] }),
    },
  });

  const response = await ports.http.get({
    url: "https://www.kuaishou.com/short-video/123",
    headers: { Origin: "https://www.kuaishou.com" },
    maxRedirects: 0,
    timeoutMs: 12_345,
    maxAttempts: 1,
  });
  await ports.downloader.download(
    { kind: "video", url: "https://cdn.example/video.m4s" },
    "task://task-1/media/video-source.bin",
    (progress) => { downloadProgress.push(progress); },
  );
  await ports.mediaTools.merge(
    "task://task-1/media/video-source.bin",
    "task://task-1/media/audio-source.bin",
    "task://task-1/media/video.mp4",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(fetches, [{
    method: "GET",
    url: "https://www.kuaishou.com/short-video/123",
    headers: { Origin: "https://www.kuaishou.com" },
    maxRedirects: 0,
    timeoutMs: 12_345,
    maxAttempts: 1,
  }]);
  assert.deepEqual(downloads, [{
    taskId: "task-1",
    sourceUrl: "https://cdn.example/video.m4s",
    artifact: { kind: "videoPart" },
    headers: undefined,
  }]);
  assert.deepEqual(downloadProgress, [
    { downloadedBytes: 12, totalBytes: 24, progress: 0.5 },
    { downloadedBytes: 24, totalBytes: 24, progress: 1 },
  ]);
  assert.deepEqual(copies, [{
    taskId: "task-1",
    sourceUri: "file:///private/tasks/task-1/media/remux/final.mp4",
    relativePath: "media/video.mp4",
  }]);
});
