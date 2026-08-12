import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "@hongtai/core";
import type { MediaDownloader, MediaTools, PlatformAdapter } from "@hongtai/core";

import { StandaloneTaskService } from "./standalone-task-service.js";

function memoryFiles() {
  const values = new Map<string, string>();
  const ids = new Set<string>();
  const key = (taskId: string, relativePath: string) => `${taskId}/${relativePath}`;
  return {
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

function imageTextAdapter(): PlatformAdapter {
  return {
    platform: "xiaohongshu",
    supportLevel: "stable",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "<html />" }),
    parse: async (link) => ({
      platform: "xiaohongshu",
      contentType: "image_text",
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: "真实图文标题",
      description: "真实正文第一段\n真实正文第二段",
      author: "真实作者",
      videos: [],
      audios: [],
      images: [],
      subtitles: [],
      raw: { note: "raw only" },
    }),
  };
}

test("StandaloneTaskService runs the existing IngestPipeline and persists its seven real events", async () => {
  const native = memoryFiles();
  const downloader: MediaDownloader = { download: async () => undefined };
  const mediaTools: MediaTools = {
    merge: async () => undefined,
    probeDuration: async () => 0,
    extractAudio: async () => undefined,
    splitAudio: async () => [],
  };
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [imageTextAdapter()],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader,
    mediaTools,
    createTaskId: () => "task-image-1",
    toDisplayUri: (value) => `display:${value}`,
  });

  const task = await service.create({ input: "复制内容 https://www.xiaohongshu.com/discovery/item/abc123" });
  assert.equal(task.status, "queued");

  const running = await service.start(task.id);
  const completed = await running.completion;
  const events = await service.listEvents(task.id);
  const detail = await service.getDetail(task.id);

  assert.equal(completed.status, "degraded", "the existing pipeline truthfully marks image text without downloadable images as degraded");
  assert.deepEqual([...new Set(events.filter((event): event is Extract<typeof event, { readonly stage: string }> => "stage" in event).map((event) => event.stage))], [
    "detect-platform", "resolve-link", "parse-content", "select-media", "download-media", "obtain-transcript", "save-artifacts",
  ]);
  assert.equal(detail?.task.contentType, "image_text");
  assert.deepEqual(detail?.evidenceUnits.map((item) => item.text), ["真实图文标题", "真实正文第一段", "真实正文第二段"]);
});

test("StandaloneTaskService writes the minimal running projection before the shared pipeline completes", async () => {
  const native = memoryFiles();
  const started = deferred();
  const release = deferred();
  const base = imageTextAdapter();
  const adapter: PlatformAdapter = {
    ...base,
    resolve: async (url, http) => {
      started.resolve();
      await release.promise;
      return base.resolve(url, http);
    },
  };
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [adapter],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-running-1",
    toDisplayUri: (value) => `display:${value}`,
  });

  const task = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  const active = await service.start(task.id);
  await started.promise;
  assert.equal((await service.get(task.id))?.status, "running");

  release.resolve();
  await active.completion;
});

test("StandaloneTaskService imports one private MP4 through the shared pipeline and deletes only its terminal task", async () => {
  const native = memoryFiles();
  let picked = 0;
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async ({ taskId }) => {
        picked += 1;
        await native.plugin.writeText({ taskId, relativePath: "media/video.mp4", value: "private-mp4", replace: true });
        return { uri: `file:///private/tasks/${taskId}/media/video.mp4`, mimeType: "video/mp4", displayName: "真实口播.mp4", sizeBytes: 128, durationSeconds: 8 };
      },
    },
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => { throw new Error("local video must not download"); } },
    mediaTools: {
      merge: async () => undefined,
      probeDuration: async () => 8,
      extractAudio: async () => undefined,
      splitAudio: async () => ["task://task-local-1/media/segments/segment-1.wav"],
    },
    transcriber: {
      transcribe: async () => ({
        status: "transcribed",
        text: "真实本地视频文稿",
        segments: [{ index: 0, startSeconds: 0, endSeconds: 8, text: "真实本地视频文稿", status: "succeeded" }],
      }),
    },
    createTaskId: () => "task-local-1",
    toDisplayUri: (value) => `display:${value}`,
  });

  const imported = await service.importVideo();
  assert.equal(imported.sourceKind, "local_video");
  assert.equal(imported.sourceUrl, "");
  assert.equal(imported.platform, undefined);
  assert.equal(imported.media[0]?.origin, "imported");
  assert.equal(picked, 1);

  await assert.rejects(() => service.delete(imported.id), /尚未完成/u);
  const completed = await (await service.start(imported.id)).completion;
  assert.equal(completed.status, "succeeded");
  await service.delete(imported.id);
  assert.equal(await service.get(imported.id), undefined);
});

test("StandaloneTaskService opens the picker without creating a task and maps cancellation", async () => {
  const native = memoryFiles();
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async () => {
        assert.deepEqual(
          (await native.plugin.listTaskIds()).taskIds,
          [],
          "opening the external picker must not create a task before a video is selected",
        );
        throw { code: "ERR_MEDIA_SELECTION_CANCELLED" };
      },
    },
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-cancelled-video",
    toDisplayUri: (value) => value,
  });

  await assert.rejects(
    () => service.importVideo(),
    (error) => error instanceof TaskError && error.code === "MEDIA_SELECTION_CANCELLED" && error.action === "select_media",
  );
  assert.deepEqual((await native.plugin.listTaskIds()).taskIds, []);
});
