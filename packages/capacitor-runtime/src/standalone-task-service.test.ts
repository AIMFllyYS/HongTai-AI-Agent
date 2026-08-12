import assert from "node:assert/strict";
import test from "node:test";

import type { MediaDownloader, MediaTools, PlatformAdapter } from "@hongtai/core";

import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneTaskService } from "./standalone-task-service.js";

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
  const operations = new RuntimeOperationRegistry();
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
    operations,
  });

  const task = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  const active = await service.start(task.id);
  await started.promise;
  assert.equal((await service.get(task.id))?.status, "running");
  assert.deepEqual(operations.list(), [{
    kind: "ingest",
    id: "task-running-1",
    source: "memory",
    execution: "in-process",
  }]);

  release.resolve();
  await active.completion;
  assert.deepEqual(operations.list(), []);
});

test("StandaloneTaskService recovers a persisted running task exactly once", async () => {
  const native = memoryFiles();
  await native.plugin.ensure({ taskId: "task-interrupted-1" });
  await native.plugin.writeText({
    taskId: "task-interrupted-1",
    relativePath: "task.json",
    value: JSON.stringify({
      id: "task-interrupted-1",
      sourceUrl: "https://www.xiaohongshu.com/discovery/item/abc123",
      status: "running",
      currentStage: "resolve-link",
      platform: "xiaohongshu",
      analysisStatus: "not_started",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:01.000Z",
      issues: [],
    }),
    replace: true,
  });
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    toDisplayUri: (value) => value,
    now: () => new Date("2026-08-12T01:02:03.000Z"),
  });

  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "ingest",
    id: "task-interrupted-1",
    source: "persisted",
    execution: "in-process",
  }]);
  assert.equal((await service.recoverInterruptedWork()).length, 1);
  assert.equal((await service.recoverInterruptedWork()).length, 0);

  const recovered = await service.get("task-interrupted-1");
  assert.equal(recovered?.status, "interrupted");
  assert.equal(recovered?.interruptedAt, "2026-08-12T01:02:03.000Z");
  assert.equal(recovered?.currentStage, "resolve-link");
  assert.equal(recovered?.issues.length, 1);
  assert.equal(recovered?.issues[0]?.code, "TASK_INTERRUPTED");
  assert.equal(recovered?.issues[0]?.action, "edit_input");
});
