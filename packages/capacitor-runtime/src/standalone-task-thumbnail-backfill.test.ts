import assert from "node:assert/strict";
import test from "node:test";

import type { TaskRecord } from "@hongtai/core";

import { StandaloneTaskService } from "./standalone-task-service.js";
import type { StandaloneTaskMediaCapturePort } from "./standalone-task-service.js";

function memoryFiles() {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const key = (taskId: string, relativePath: string) => `${taskId}/${relativePath}`;
  return {
    values,
    plugin: {
      ensure: async ({ taskId }: { readonly taskId: string }) => { ids.add(taskId); },
      writeText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => {
        values.set(key(taskId, relativePath), value);
      },
      appendText: async ({ taskId, relativePath, value }: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => {
        values.set(key(taskId, relativePath), `${values.get(key(taskId, relativePath)) ?? ""}${value}`);
      },
      readText: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ value: values.get(key(taskId, relativePath)) }),
      exists: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({ exists: values.has(key(taskId, relativePath)) }),
      listTaskIds: async () => ({ taskIds: [...ids] }),
      deleteTask: async ({ taskId }: { readonly taskId: string }) => {
        ids.delete(taskId);
        for (const path of [...values.keys()]) if (path.startsWith(`${taskId}/`)) values.delete(path);
      },
      getUri: async ({ taskId, relativePath }: { readonly taskId: string; readonly relativePath: string }) => ({
        uri: values.has(key(taskId, relativePath)) ? `file:///private/tasks/${taskId}/${relativePath}` : undefined,
        ...(values.has(key(taskId, relativePath)) && relativePath.endsWith(".jpg") ? { mimeType: "image/jpeg" as const } : {}),
      }),
    },
  };
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => { resolve = done; }),
    resolve,
  };
}

const TASK_ID = "task-video-1";

function videoTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: TASK_ID,
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    sourceKind: "public_link",
    status: "succeeded",
    platform: "bilibili",
    contentType: "video",
    analysisStatus: "not_started",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    issues: [],
    ...overrides,
  };
}

async function persistTask(native: ReturnType<typeof memoryFiles>, task: TaskRecord, options: { readonly withVideo?: boolean; readonly withThumbnail?: boolean } = {}) {
  await native.plugin.ensure({ taskId: task.id });
  await native.plugin.writeText({ taskId: task.id, relativePath: "task.json", value: JSON.stringify(task), replace: true });
  if (options.withVideo !== false) {
    await native.plugin.writeText({ taskId: task.id, relativePath: "media/video.mp4", value: "private-mp4", replace: true });
  }
  if (options.withThumbnail === true) {
    await native.plugin.writeText({ taskId: task.id, relativePath: "media/thumbnail.jpg", value: "jpeg-bytes", replace: true });
  }
}

function serviceFor(native: ReturnType<typeof memoryFiles>, media?: StandaloneTaskMediaCapturePort): StandaloneTaskService {
  return new StandaloneTaskService({
    files: native.plugin,
    adapters: [],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    ...(media ? { media } : {}),
    toDisplayUri: (value) => `display:${value}`,
  });
}

test("getDetail backfills the persisted first frame once for a video task that has none", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask());
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async ({ taskId }) => {
      captures += 1;
      await native.plugin.writeText({ taskId, relativePath: "media/thumbnail.jpg", value: "jpeg-bytes", replace: true });
      return { uri: `file:///private/tasks/${taskId}/media/thumbnail.jpg`, sizeBytes: 10, mimeType: "image/jpeg" };
    },
  });

  const detail = await service.getDetail(TASK_ID);
  assert.equal(captures, 1);
  assert.deepEqual(detail?.media.map((item) => [item.kind, item.displayName]), [["video", "下载的视频"], ["image", "视频首帧"]]);
  assert.equal(detail?.content.cover?.kind, "image");
  assert.equal(detail?.content.cover?.uri, `display:file:///private/tasks/${TASK_ID}/media/thumbnail.jpg`);

  const again = await service.getDetail(TASK_ID);
  assert.equal(captures, 1, "a persisted thumbnail must not be captured again");
  assert.deepEqual(again?.media.map((item) => item.kind), ["video", "image"]);
});

test("a failed frame capture is remembered for the process and never fails the read", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask());
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async () => {
      captures += 1;
      throw new Error("ERR_MEDIA_PROBE_FAILED");
    },
  });

  const detail = await service.getDetail(TASK_ID);
  assert.deepEqual(detail?.media.map((item) => item.kind), ["video"]);
  assert.equal(detail?.content.cover?.kind, "video");

  await service.get(TASK_ID);
  await service.getDetail(TASK_ID);
  assert.equal(captures, 1, "a captured failure must not be retried within this process");
});

test("concurrent reads share a single frame capture", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask());
  const entered = deferred();
  const release = deferred();
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async ({ taskId }) => {
      captures += 1;
      entered.resolve();
      await release.promise;
      await native.plugin.writeText({ taskId, relativePath: "media/thumbnail.jpg", value: "jpeg-bytes", replace: true });
      return { uri: `file:///private/tasks/${taskId}/media/thumbnail.jpg`, sizeBytes: 10, mimeType: "image/jpeg" };
    },
  });

  const pending = Promise.all([service.get(TASK_ID), service.getDetail(TASK_ID)]);
  await entered.promise;
  release.resolve();
  const [record, detail] = await pending;
  assert.equal(captures, 1, "concurrent reads must single-flight the native capture");
  assert.deepEqual(record?.media.map((item) => item.kind), ["video", "image"]);
  assert.deepEqual(detail?.media.map((item) => item.kind), ["video", "image"]);
});

test("reads without a native capture port keep the un-thumbnailed media", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask());
  const service = serviceFor(native);

  const detail = await service.getDetail(TASK_ID);
  assert.deepEqual(detail?.media.map((item) => item.kind), ["video"]);
  assert.equal(detail?.content.cover?.kind, "video");
});

test("a video task that already has a thumbnail never captures one", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask(), { withThumbnail: true });
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async () => {
      captures += 1;
      return { uri: "file:///unused", sizeBytes: 1, mimeType: "image/jpeg" };
    },
  });

  const detail = await service.getDetail(TASK_ID);
  assert.equal(captures, 0);
  assert.deepEqual(detail?.media.map((item) => item.kind), ["video", "image"]);
});

test("a video task without its stored video has nothing to capture from", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask(), { withVideo: false });
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async () => {
      captures += 1;
      return { uri: "file:///unused", sizeBytes: 1, mimeType: "image/jpeg" };
    },
  });

  const detail = await service.getDetail(TASK_ID);
  assert.equal(captures, 0);
  assert.deepEqual(detail?.media, []);
});

test("image_text tasks never trigger a frame capture", async () => {
  const native = memoryFiles();
  await persistTask(native, videoTask({ contentType: "image_text" }));
  let captures = 0;
  const service = serviceFor(native, {
    captureFrame: async () => {
      captures += 1;
      return { uri: "file:///unused", sizeBytes: 1, mimeType: "image/jpeg" };
    },
  });

  await service.getDetail(TASK_ID);
  assert.equal(captures, 0);
});
