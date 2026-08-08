import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "@hongtai/core";
import { NativeIngestPorts } from "./thin-ingest-ports.js";

function portsWithFetchFailure(failure: unknown): NativeIngestPorts {
  return new NativeIngestPorts({
    network: {
      fetchText: async () => { throw failure; },
      download: async () => ({ uri: "file:///private/media.bin", sizeBytes: 1 }),
    },
    files: {
      getUri: async () => ({ uri: "file:///private/media.bin" }),
      copyPrivateFile: async () => {},
    },
    media: {
      remuxVideo: async () => ({ uri: "file:///private/video.mp4", sizeBytes: 1, mimeType: "video/mp4", hasAudio: true }),
      probe: async () => ({ durationMs: 1_000 }),
      extractPcmWav: async () => ({ uri: "file:///private/audio.wav", sizeBytes: 1, sampleRateHz: 8_000, channelCount: 1 }),
      segmentPcmWav: async () => ({ sourceDurationMs: 1_000, segments: [] }),
    },
  });
}

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

test("NativeIngestPorts maps Capacitor link rejection codes to stable TaskErrors", async () => {
  const cases = [
    ["ERR_LINK_DNS_FAILED", "LINK_NETWORK_FAILED", "check_network", true],
    ["ERR_LINK_TLS_FAILED", "LINK_NETWORK_FAILED", "check_network", true],
    ["ERR_LINK_CONNECTION_FAILED", "LINK_NETWORK_FAILED", "check_network", true],
    ["ERR_LINK_TIMEOUT", "LINK_TIMEOUT", "check_network", true],
    ["ERR_LINK_REDIRECT_LIMIT", "LINK_REDIRECT_LIMIT", "edit_input", false],
    ["ERR_LINK_REDIRECT_INVALID", "LINK_REDIRECT_INVALID", "edit_input", false],
    ["ERR_LINK_RESPONSE_TOO_LARGE", "LINK_HTTP_ERROR", "retry", false],
    ["ERR_LINK_RESPONSE_INVALID", "LINK_HTTP_ERROR", "retry", false],
    ["ERR_LINK_RESPONSE_FAILED", "LINK_NETWORK_FAILED", "check_network", true],
  ] as const;

  for (const [nativeCode, applicationCode, action, retryable] of cases) {
    const ports = portsWithFetchFailure({
      code: nativeCode,
      message: "raw native message must not be rendered",
      data: {
        schemaVersion: "native-link-diagnostic.v1",
        operation: "fetch-text",
        phase: nativeCode.includes("REDIRECT") ? "redirect" : "connect",
        hostname: "www.douyin.com",
        errorClass: "timeout",
        elapsedMs: 345,
        attempt: 1,
        redirectCount: 0,
      },
    });

    await assert.rejects(
      () => ports.http.get({ url: "https://www.douyin.com/video/1" }),
      (error) => error instanceof TaskError
        && error.code === applicationCode
        && error.action === action
        && error.retryable === retryable
        && error.details?.nativeCode === nativeCode
        && !error.message.includes("raw native message"),
    );
  }
});

test("NativeIngestPorts allowlists native-link-diagnostic v1 fields before TaskIssue persistence", async () => {
  const ports = portsWithFetchFailure({
    code: "ERR_LINK_TIMEOUT",
    message: "SocketTimeoutException https://www.douyin.com/video/1?query-secret",
    data: {
      schemaVersion: "native-link-diagnostic.v1",
      operation: "fetch-text",
      phase: "response",
      hostname: "www.douyin.com",
      errorClass: "timeout",
      elapsedMs: 1_234,
      networkType: "wifi",
      attempt: 2,
      redirectCount: 1,
      url: "https://www.douyin.com/video/1?query-secret",
      Cookie: "session-secret",
      throwableMessage: "SocketTimeoutException raw-text",
    },
  });

  await assert.rejects(
    () => ports.http.get({ url: "https://www.douyin.com/video/1" }),
    (error) => {
      if (!(error instanceof TaskError)) return false;
      assert.deepEqual(error.diagnostic, {
        schemaVersion: "native-link-diagnostic.v1",
        operation: "fetch-text",
        phase: "response",
        hostname: "www.douyin.com",
        errorClass: "timeout",
        elapsedMs: 1_234,
        networkType: "wifi",
        attempt: 2,
        redirectCount: 1,
      });
      const serialized = JSON.stringify(error);
      assert.doesNotMatch(serialized, /query-secret|session-secret|SocketTimeoutException|raw-text|Cookie|throwableMessage/);
      return true;
    },
  );

  const ipPorts = portsWithFetchFailure({
    code: "ERR_LINK_CONNECTION_FAILED",
    data: {
      schemaVersion: "native-link-diagnostic.v1",
      operation: "fetch-text",
      phase: "connect",
      hostname: "192.0.2.42",
      errorClass: "connection",
      elapsedMs: 12,
      attempt: 1,
      redirectCount: 0,
    },
  });
  await assert.rejects(
    () => ipPorts.http.get({ url: "https://www.douyin.com/video/1" }),
    (error) => error instanceof TaskError && error.diagnostic?.hostname === undefined,
  );
});
