import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "@hongtai/core";
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

test("StandaloneTaskService emits finite task changes only after the persisted projection is readable", async () => {
  const native = memoryFiles();
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [imageTextAdapter()],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-change-1",
    toDisplayUri: (value) => `display:${value}`,
  });
  const changes: Array<{ readonly type: string; readonly status?: string; readonly persistedStatus?: string }> = [];
  service.subscribeChanges(async (event) => {
    if (event.type === "deleted") {
      changes.push({ type: event.type, persistedStatus: (await service.get(event.taskId))?.status });
      return;
    }
    changes.push({
      type: event.type,
      status: event.task.status,
      persistedStatus: (await service.get(event.task.id))?.status,
    });
  });

  const queued = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  const completed = await (await service.start(queued.id)).completion;
  await service.setAnalysisStatus(queued.id, "succeeded");
  await service.delete(queued.id);

  assert.equal(completed.status, "degraded");
  assert.deepEqual(changes, [
    { type: "upsert", status: "queued", persistedStatus: "queued" },
    { type: "upsert", status: "running", persistedStatus: "running" },
    { type: "upsert", status: "degraded", persistedStatus: "degraded" },
    { type: "upsert", status: "degraded", persistedStatus: "degraded" },
    { type: "deleted", persistedStatus: undefined },
  ]);
});

test("StandaloneTaskService isolates page listener failures from persisted task outcomes", async () => {
  const native = memoryFiles();
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [imageTextAdapter()],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-listener-failure",
    toDisplayUri: (value) => value,
  });
  service.subscribeChanges(() => { throw new Error("broken task list view"); });

  const task = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  service.subscribe(task.id, () => { throw new Error("broken processing view"); });
  const completed = await (await service.start(task.id)).completion;

  assert.equal(completed.status, "degraded");
  assert.equal((await service.get(task.id))?.status, "degraded");
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

test("StandaloneTaskService imports one private MP4 through the shared pipeline and deletes only its terminal task", async () => {
  const native = memoryFiles();
  let picked = 0;
  const taskIds = ["task-existing-1", "task-local-1"];
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async ({ taskId }) => {
        picked += 1;
        await native.plugin.writeText({ taskId, relativePath: "media/video.mp4", value: "private-mp4", replace: true });
        return { uri: `file:///private/tasks/${taskId}/media/video.mp4`, mimeType: "video/mp4", displayName: "真实口播.mp4", sizeBytes: 128, durationSeconds: 8 };
      },
      consumeVideoOperation: async () => ({ status: "none" as const }),
    },
    adapters: [imageTextAdapter()],
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
    createTaskId: () => taskIds.shift() ?? "task-unexpected",
    toDisplayUri: (value) => `display:${value}`,
  });

  const existing = await service.create({ input: "复制内容 https://www.xiaohongshu.com/discovery/item/existing" });
  const imported = await service.importVideo();
  assert.equal(imported.sourceKind, "local_video");
  assert.equal(imported.sourceUrl, "");
  assert.equal(imported.platform, undefined);
  assert.equal(imported.media[0]?.origin, "imported");
  assert.equal(picked, 1);

  await assert.rejects(() => service.delete(imported.id), /尚未完成/u);
  const completed = await (await service.start(imported.id)).completion;
  assert.equal(completed.status, "succeeded");
  assert.equal((await service.get(existing.id))?.status, "queued", "picker return must not interrupt an unrelated task");
  await service.delete(imported.id);
  assert.equal(await service.get(imported.id), undefined);
});

test("StandaloneTaskService tracks the local-video picker and recovers its queued snapshot after interruption", async () => {
  const native = memoryFiles();
  const pickerEntered = deferred();
  const pickerRelease = deferred();
  const operations = new RuntimeOperationRegistry();
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async ({ taskId }) => {
        pickerEntered.resolve();
        await pickerRelease.promise;
        await native.plugin.writeText({ taskId, relativePath: "media/video.mp4", value: "private-mp4", replace: true });
        return { uri: `file:///private/tasks/${taskId}/media/video.mp4`, mimeType: "video/mp4", displayName: "恢复测试.mp4", sizeBytes: 128, durationSeconds: 8 };
      },
      consumeVideoOperation: async () => ({ status: "none" as const }),
    },
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 8, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-local-recovery",
    toDisplayUri: (value) => value,
    now: () => new Date("2026-08-13T01:02:03.000Z"),
    operations,
  });

  const importing = service.importVideo();
  await pickerEntered.promise;
  assert.deepEqual((await native.plugin.listTaskIds()).taskIds, [], "external selection must remain transient until a real MP4 returns");
  assert.deepEqual(operations.list(), [{
    kind: "transient-operation",
    id: "task-video:task-local-recovery",
    source: "memory",
    execution: "external-activity",
  }]);

  pickerRelease.resolve();
  const queued = await importing;
  assert.equal(queued.status, "queued");
  assert.deepEqual(operations.list(), []);
  assert.deepEqual(await service.inspectUnfinishedWork(), [{
    kind: "ingest",
    id: "task-local-recovery",
    source: "persisted",
    execution: "in-process",
  }]);

  const recoveredWork = await service.recoverInterruptedWork();
  assert.equal(recoveredWork.length, 1);
  const recovered = await service.get("task-local-recovery");
  assert.equal(recovered?.status, "interrupted");
  assert.equal(recovered?.issues.at(-1)?.code, "TASK_INTERRUPTED");
  assert.equal(recovered?.issues.at(-1)?.action, "select_media");
  assert.match(recovered?.issues.at(-1)?.userMessage ?? "", /重新选择.*视频/u);
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
      consumeVideoOperation: async () => ({ status: "none" as const }),
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

function filesWithEnsureLimit(successfulEnsures: number) {
  const native = memoryFiles();
  const ensure = native.plugin.ensure;
  let calls = 0;
  return {
    values: native.values,
    plugin: {
      ...native.plugin,
      ensure: async (options: { readonly taskId: string }) => {
        calls += 1;
        if (calls > successfulEnsures) throw new Error("no space left");
        return ensure(options);
      },
    },
  };
}

test("StandaloneTaskService persists initialize failure as failed instead of leaving public-link queued", async () => {
  const native = filesWithEnsureLimit(1);
  const changes: Array<{ readonly status?: string; readonly persistedStatus?: string }> = [];
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [imageTextAdapter()],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-init-fail-public",
    toDisplayUri: (value) => value,
    now: () => new Date("2026-08-16T09:00:00.000Z"),
  });
  service.subscribeChanges(async (event) => {
    if (event.type !== "upsert") return;
    changes.push({
      status: event.task.status,
      persistedStatus: JSON.parse(native.values.get(`${event.task.id}/task.json`) ?? "{}").status,
    });
  });

  const queued = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  assert.equal(queued.status, "queued");
  const completed = await (await service.start(queued.id)).completion;
  const persisted = JSON.parse(native.values.get("task-init-fail-public/task.json") ?? "{}");
  const listed = await service.list();

  assert.equal(completed.status, "failed");
  assert.equal(persisted.status, "failed");
  assert.equal(persisted.issues.at(-1)?.code, "STORAGE_WRITE_FAILED");
  assert.equal(persisted.issues.at(-1)?.action, "free_storage");
  assert.equal((await service.get(queued.id))?.status, "failed");
  assert.equal(listed[0]?.status, "failed");
  assert.deepEqual(await service.inspectUnfinishedWork(), []);
  assert.equal((await service.recoverInterruptedWork()).length, 0);
  assert.deepEqual(changes.at(-1), { status: "failed", persistedStatus: "failed" });
});

test("StandaloneTaskService persists initialize failure as failed for local video instead of leaving queued", async () => {
  const native = filesWithEnsureLimit(1);
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async ({ taskId }) => {
        await native.plugin.writeText({ taskId, relativePath: "media/video.mp4", value: "private-mp4", replace: true });
        return { uri: `file:///private/tasks/${taskId}/media/video.mp4`, mimeType: "video/mp4", displayName: "初始化失败.mp4", sizeBytes: 128, durationSeconds: 8 };
      },
      consumeVideoOperation: async () => ({ status: "none" as const }),
    },
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 8, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-init-fail-local",
    toDisplayUri: (value) => value,
    now: () => new Date("2026-08-16T09:00:00.000Z"),
  });

  const imported = await service.importVideo();
  assert.equal(imported.status, "queued");
  const completed = await (await service.start(imported.id)).completion;
  const persisted = JSON.parse(native.values.get("task-init-fail-local/task.json") ?? "{}");

  assert.equal(completed.status, "failed");
  assert.equal(persisted.status, "failed");
  assert.equal(persisted.issues.at(-1)?.code, "STORAGE_WRITE_FAILED");
  assert.equal((await service.get(imported.id))?.status, "failed");
  assert.deepEqual(await service.inspectUnfinishedWork(), []);
  assert.equal((await service.recoverInterruptedWork()).length, 0);
  assert.notEqual(persisted.status, "interrupted");
});

test("StandaloneTaskService single-flights concurrent start for the same taskId", async () => {
  const native = memoryFiles();
  const started = deferred();
  const release = deferred();
  let resolveCalls = 0;
  const base = imageTextAdapter();
  const adapter: PlatformAdapter = {
    ...base,
    resolve: async (url, http) => {
      resolveCalls += 1;
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
    createTaskId: () => "task-single-flight",
    toDisplayUri: (value) => value,
  });

  const task = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/abc123" });
  const [first, second] = await Promise.all([service.start(task.id), service.start(task.id)]);
  assert.equal(first, second, "same taskId must return the same in-flight CancellableTask");
  await started.promise;
  const late = await service.start(task.id);
  assert.equal(late, first);
  assert.equal(resolveCalls, 1);

  release.resolve();
  const [left, right] = await Promise.all([first.completion, second.completion]);
  assert.equal(left.status, right.status);
  assert.equal(left.id, right.id);
  assert.equal(resolveCalls, 1);
  assert.equal((await service.get(task.id))?.status, "degraded");
});

test("StandaloneTaskService still runs different taskIds in parallel", async () => {
  const native = memoryFiles();
  const firstEntered = deferred();
  const secondEntered = deferred();
  const release = deferred();
  let inFlight = 0;
  let maxInFlight = 0;
  const ids = ["task-parallel-a", "task-parallel-b"];
  const base = imageTextAdapter();
  const adapter: PlatformAdapter = {
    ...base,
    resolve: async (url, http) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === 1) firstEntered.resolve();
      if (inFlight === 2) secondEntered.resolve();
      await release.promise;
      inFlight -= 1;
      return base.resolve(url, http);
    },
  };
  const service = new StandaloneTaskService({
    files: native.plugin,
    adapters: [adapter],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => ids.shift() ?? "task-unexpected",
    toDisplayUri: (value) => value,
  });

  const firstTask = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/aaa111" });
  const secondTask = await service.create({ input: "https://www.xiaohongshu.com/discovery/item/bbb222" });
  const [first, second] = await Promise.all([service.start(firstTask.id), service.start(secondTask.id)]);
  assert.notEqual(first, second);
  await Promise.all([firstEntered.promise, secondEntered.promise]);
  assert.equal(maxInFlight, 2, "different taskIds must overlap in the shared pipeline");

  release.resolve();
  const [left, right] = await Promise.all([first.completion, second.completion]);
  assert.equal(left.id, firstTask.id);
  assert.equal(right.id, secondTask.id);
  assert.equal(left.status, "degraded");
  assert.equal(right.status, "degraded");
});

test("StandaloneTaskService consumes a recovered native video as a queued local task", async () => {
  const native = memoryFiles();
  const service = new StandaloneTaskService({
    files: native.plugin,
    fileMedia: {
      pickVideo: async () => { throw new Error("unused"); },
      consumeVideoOperation: async () => ({
        status: "succeeded" as const,
        taskId: "task-recovered-video",
        uri: "file:///private/tasks/task-recovered-video/media/video.mp4",
        mimeType: "video/mp4" as const,
        displayName: "恢复口播.mp4",
        sizeBytes: 256,
        durationSeconds: 12,
      }),
    },
    adapters: [],
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => undefined },
    mediaTools: { merge: async () => undefined, probeDuration: async () => 12, extractAudio: async () => undefined, splitAudio: async () => [] },
    createTaskId: () => "task-unused",
    toDisplayUri: (value) => `capacitor://localhost/tasks/${encodeURIComponent(value)}`,
  });

  const recovered = await service.consumeVideoRecovery();

  assert.equal(recovered.status, "succeeded");
  if (recovered.status !== "succeeded") assert.fail("expected a recovered video task");
  assert.equal(recovered.task.id, "task-recovered-video");
  assert.equal(recovered.task.sourceKind, "local_video");
  assert.equal(recovered.task.status, "queued");
  assert.doesNotMatch(JSON.stringify(recovered), /file:\/\//);
});

test("StandaloneTaskService maps every recovered native video terminal to a stable TaskIssue", async () => {
  const expected = new Map<string, string>([
    ["ERR_MEDIA_SELECTION_CANCELLED", "MEDIA_SELECTION_CANCELLED"],
    ["ERR_MEDIA_SOURCE_MISSING", "MEDIA_SOURCE_NOT_FOUND"],
    ["ERR_VIDEO_RECOVERY_FAILED", "TASK_INTERRUPTED"],
    ["ERR_MEDIA_READ_FAILED", "MEDIA_READ_FAILED"],
    ["ERR_PRIVATE_FILE_IMPORT_FAILED", "MEDIA_IMPORT_FAILED"],
  ]);

  for (const [nativeCode, taskCode] of expected) {
    const native = memoryFiles();
    const service = new StandaloneTaskService({
      files: native.plugin,
      fileMedia: {
        pickVideo: async () => { throw new Error("unused"); },
        consumeVideoOperation: async () => ({ status: "failed" as const, code: nativeCode }),
      },
      adapters: [],
      http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }), post: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
      downloader: { download: async () => undefined },
      mediaTools: { merge: async () => undefined, probeDuration: async () => 0, extractAudio: async () => undefined, splitAudio: async () => [] },
      toDisplayUri: (value) => value,
    });

    const recovered = await service.consumeVideoRecovery();

    assert.equal(recovered.status, "failed", nativeCode);
    if (recovered.status !== "failed") assert.fail(`expected ${nativeCode} to fail`);
    assert.equal(recovered.issue.code, taskCode, nativeCode);
    assert.equal(recovered.issue.action, "select_media", nativeCode);
    assert.equal(recovered.issue.details?.nativeCode, nativeCode);
  }
});
