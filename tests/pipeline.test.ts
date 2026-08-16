import assert from "node:assert/strict";
import test from "node:test";
import type {
  ArtifactStore,
  HttpClient,
  IngestPipelineDependencies,
  MediaDownloader,
  MediaTools,
  PlatformAdapter,
  ProgressEvent,
  TaskPaths,
} from "../packages/core/src/index";
import { IngestPipeline, PIPELINE_STAGES, TaskError } from "../packages/core/src/index";

const paths: TaskPaths = {
  root: "task",
  task: "task/task.json",
  log: "task/task.log",
  metadata: "task/metadata.json",
  rawResponse: "task/raw/response.json",
  rawPage: "task/raw/page.html",
  video: "task/media/video.mp4",
  videoPart: "task/media/video-only.m4s",
  audioPart: "task/media/audio-only.m4s",
  audio: "task/media/audio.wav",
  imageDirectory: "task/media/images",
  contentText: "task/content/content.txt",
  segmentDirectory: "task/media/segments",
  transcript: "task/transcript/transcript.txt",
  transcriptJson: "task/transcript/transcript.json",
  draft: "task/transcript/draft.txt",
};

function latestEventByStage(events: readonly ProgressEvent[]): Map<ProgressEvent["stage"], ProgressEvent> {
  const latest = new Map<ProgressEvent["stage"], ProgressEvent>();
  for (const event of events) latest.set(event.stage, event);
  return latest;
}

function assertSevenStagesTerminal(events: readonly ProgressEvent[]): Map<ProgressEvent["stage"], ProgressEvent> {
  const latest = latestEventByStage(events);
  for (const stage of PIPELINE_STAGES) {
    const event = latest.get(stage);
    assert.ok(event, `stage ${stage} must have a terminal event`);
    assert.notEqual(event.status, "pending", `${stage} must not stay pending`);
    assert.notEqual(event.status, "running", `${stage} must not stay running`);
  }
  return latest;
}

class MemoryStore implements ArtifactStore {
  readonly values = new Map<string, string>();
  async initializeTask(): Promise<TaskPaths> { return paths; }
  async writeJson(path: string, value: unknown): Promise<void> { this.values.set(path, JSON.stringify(value)); }
  async writeText(path: string, value: string): Promise<void> { this.values.set(path, value); }
  async appendText(path: string, value: string): Promise<void> { this.values.set(path, (this.values.get(path) ?? "") + value); }
  imagePath(_paths: TaskPaths, index: number): string { return `task/media/images/image-${index + 1}.jpg`; }
}

function dependencies(withVideo: boolean, withAudio = false): { dependencies: IngestPipelineDependencies; events: ProgressEvent[]; store: MemoryStore } {
  const events: ProgressEvent[] = [];
  const store = new MemoryStore();
  const adapter: PlatformAdapter = {
    platform: "douyin",
    supportLevel: "stable",
    matches: () => true,
    resolve: async (url) => ({
      sourceUrl: url,
      finalUrl: `${url}?xsec_token=private-token`,
      status: 200,
      body: '<html><img src="https://cdn.example/cover.jpg?signature=fake-sign"></html>',
    }),
    parse: async (link) => ({
      platform: "douyin",
      contentType: "video",
      id: "synthetic-aweme-1",
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: "测试",
      description: "平台描述",
      author: "作者甲",
      videos: withVideo ? [{
        kind: "video",
        url: "https://media.example/video.mp4?signature=media-secret",
        hasWatermark: false,
        headers: { Referer: "https://platform.example/item", Cookie: "synthetic-cookie", Authorization: "Bearer SYNTHETIC" },
      }] : [],
      audios: withAudio ? [{ kind: "audio", url: "https://media.example/audio.m4s" }] : [],
      images: [],
      subtitles: [],
      raw: {
        item: {
          play_addr: "https://cdn.example/play.mp4?signature=fake-sign",
          Cookie: "synthetic-cookie",
          Authorization: "Bearer SYNTHETIC",
        },
        view: { title: "leak" },
        play: { dash: "https://video.example/a.m4s?signature=fake-sign" },
        note: { url: "https://img.example/n.jpg?signature=fake-sign" },
      },
    }),
  };
  const http: HttpClient = {
    get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
  };
  const downloader: MediaDownloader = { download: async (_source, _destination, progress) => { await progress?.({ downloadedBytes: 10, totalBytes: 10, progress: 1 }); } };
  const mediaTools: MediaTools = {
    merge: async () => {},
    probeDuration: async () => 10,
    extractAudio: async () => {},
    splitAudio: async () => ["segment.wav"],
  };
  return {
    events,
    store,
    dependencies: {
      adapters: [adapter], http, downloader, mediaTools, store,
      transcriber: { transcribe: async (_paths, seconds, callback) => {
        const segment = { index: 0, startSeconds: 0, endSeconds: seconds, text: "原始文稿", status: "succeeded" as const };
        await callback?.(segment, 1, 1);
        return { status: "transcribed", text: segment.text, segments: [segment] };
      } },
      rewriter: { rewrite: async () => "整理文稿" },
      reporter: { report: (event) => { events.push(event); } },
    },
  };
}

test("完整流水线覆盖七个阶段、保留两种文稿并清理日志URL", async () => {
  const setup = dependencies(true);
  const result = await new IngestPipeline(setup.dependencies).run({ input: "复制打开抖音 https://www.douyin.com/video/1 后续还有 https://b23.tv/ignored" });
  assert.equal(result.status, "succeeded");
  assert.ok(result.videoPath);
  assert.match(setup.store.values.get(paths.transcript) ?? "", /原始文稿/);
  assert.match(setup.store.values.get(paths.draft) ?? "", /整理文稿/);
  assert.doesNotMatch(setup.store.values.get(paths.log) ?? "", /private-token|xsec_token/);
  assert.doesNotMatch(setup.store.values.get(paths.task) ?? "", /复制打开抖音|后续还有|b23\.tv/);
  assert.doesNotMatch(setup.store.values.get(paths.metadata) ?? "", /private-token|xsec_token|media-secret|signature|Cookie|session=secret|synthetic-cookie|Bearer SYNTHETIC|fake-sign/);
  assert.doesNotMatch(setup.store.values.get(paths.metadata) ?? "", /"raw"/, "metadata is the safe presentation projection, not a raw platform response");
  assert.equal(setup.store.values.has(paths.rawPage), false, "rawPage HTML is not a product artifact");
  const rawResponse = setup.store.values.get(paths.rawResponse) ?? "";
  assert.doesNotMatch(rawResponse, /Cookie|Authorization|signature=|fake-sign|synthetic-cookie|Bearer SYNTHETIC|media-secret|private-token/i);
  assert.doesNotMatch(rawResponse, /https?:\/\/[^"\s]*\?/);
  assert.doesNotMatch(rawResponse, /"item"|"view"|"play"|"note"/);
  assert.equal(setup.events.find((event) => event.stage === "detect-platform" && event.status === "succeeded")?.detail?.ignoredSupportedUrlCount, 1);
  assert.equal(setup.events.some((event) => event.message === "媒体校验通过：时长=10秒"), true);
  for (const stage of ["detect-platform", "resolve-link", "parse-content", "select-media", "download-media"] as const) {
    const completed = setup.events.find((event) => event.stage === stage && event.status === "succeeded");
    assert.match(completed?.message ?? "", /耗时 \d+ms/);
  }
  assert.deepEqual(new Set(setup.events.map((event) => event.stage)), new Set([
    "detect-platform", "resolve-link", "parse-content", "select-media", "download-media", "obtain-transcript", "save-artifacts",
  ]));
  assert.deepEqual(
    setup.events.map((event) => event.sequence),
    setup.events.map((_event, index) => index + 1),
  );
});

test("任务事件先持久化投影和事件日志再通知页面", async () => {
  const setup = dependencies(true);
  const callbackSnapshots: Array<{
    readonly event: ProgressEvent;
    readonly persistedEvent?: ProgressEvent;
    readonly persistedTask?: { readonly currentStage?: string; readonly status?: string };
  }> = [];
  const pipeline = new IngestPipeline({
    ...setup.dependencies,
    reporter: {
      report: (event) => {
        const persistedEvents = (setup.store.values.get(paths.log) ?? "")
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ProgressEvent);
        const taskValue = setup.store.values.get(paths.task);
        callbackSnapshots.push({
          event,
          persistedEvent: persistedEvents.at(-1),
          persistedTask: taskValue
            ? JSON.parse(taskValue) as { readonly currentStage?: string; readonly status?: string }
            : undefined,
        });
      },
    },
  });

  const result = await pipeline.run({ input: "https://www.douyin.com/video/1" });

  assert.equal(result.status, "succeeded");
  assert.ok(callbackSnapshots.length > 0);
  for (const snapshot of callbackSnapshots) {
    assert.deepEqual(
      snapshot.persistedEvent,
      JSON.parse(JSON.stringify(snapshot.event)) as ProgressEvent,
      "events.jsonl must already contain the event visible to the page",
    );
    assert.equal(snapshot.persistedTask?.currentStage, snapshot.event.stage, "task.json must already expose the notified stage");
  }
  const terminal = callbackSnapshots.at(-1);
  assert.equal(terminal?.event.stage, "save-artifacts");
  assert.equal(terminal?.event.status, "succeeded");
  assert.equal(terminal?.persistedTask?.status, "succeeded", "the terminal callback must not observe a stale running task");
});

test("失败事件通知前已经持久化失败终态", async () => {
  const setup = dependencies(true);
  const base = setup.dependencies.adapters[0]!;
  const notified: ProgressEvent[] = [];
  const failedSnapshots: Array<{ readonly logContainsEvent: boolean; readonly taskStatus?: string }> = [];
  const skipSnapshots: Array<string | undefined> = [];
  const pipeline = new IngestPipeline({
    ...setup.dependencies,
    adapters: [{
      ...base,
      resolve: async () => {
        throw new TaskError({ code: "LINK_TIMEOUT", message: "页面抓取超时，请检查网络后重试", action: "check_network" });
      },
    }],
    reporter: {
      report: (event) => {
        notified.push(event);
        const persistedEvents = (setup.store.values.get(paths.log) ?? "")
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ProgressEvent);
        const taskValue = setup.store.values.get(paths.task);
        const taskStatus = taskValue
          ? (JSON.parse(taskValue) as { readonly status?: string }).status
          : undefined;
        if (event.message === "上游阶段已失败，已跳过") skipSnapshots.push(taskStatus);
        if (event.status !== "failed") return;
        failedSnapshots.push({
          logContainsEvent: persistedEvents.some((item) => item.sequence === event.sequence),
          taskStatus,
        });
      },
    },
  });

  const result = await pipeline.run({ input: "https://www.douyin.com/video/1" });

  assert.equal(result.status, "failed");
  assert.deepEqual(failedSnapshots, [{ logContainsEvent: true, taskStatus: "failed" }]);
  assert.ok(skipSnapshots.length > 0);
  assert.equal(skipSnapshots.every((status) => status === "failed"), true);
  assert.equal(notified.at(-1)?.status, "failed");
  assert.equal(notified.at(-1)?.stage, "resolve-link");
  const task = JSON.parse(setup.store.values.get(paths.task) ?? "{}") as { readonly status?: string; readonly currentStage?: string };
  assert.equal(task.status, "failed");
  assert.equal(task.currentStage, "resolve-link");
});

test("已创建的本地任务可把固定任务ID交给共享流水线而不重新生成记录", async () => {
  const setup = dependencies(true);

  const result = await new IngestPipeline(setup.dependencies).run({
    input: "https://www.douyin.com/video/1",
    taskId: "local-task-42",
  });

  assert.equal(result.taskId, "local-task-42");
  assert.equal(setup.events.every((event) => event.taskId === "local-task-42"), true);
  assert.match(setup.store.values.get(paths.task) ?? "", /"id":"local-task-42"/);
});

test("本地上传视频复用七阶段和ASR证据且不伪造平台或下载", async () => {
  const setup = dependencies(true);
  let adapterCalled = false;
  let downloaderCalled = false;
  const result = await new IngestPipeline({
    ...setup.dependencies,
    adapters: setup.dependencies.adapters.map((adapter) => ({
      ...adapter,
      matches: () => { adapterCalled = true; return true; },
      resolve: async (...args) => { adapterCalled = true; return adapter.resolve(...args); },
    })),
    downloader: {
      download: async () => { downloaderCalled = true; },
    },
  }).run({
    taskId: "task-local-video",
    localVideo: { displayName: "口播原片.mp4" },
  });

  const task = JSON.parse(setup.store.values.get(paths.task) ?? "{}") as {
    readonly sourceKind?: string;
    readonly sourceUrl?: string;
    readonly platform?: string;
  };
  const metadata = JSON.parse(setup.store.values.get(paths.metadata) ?? "{}") as {
    readonly title?: string;
    readonly sourceKind?: string;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.sourceKind, "local_video");
  assert.equal(result.platform, undefined);
  assert.equal(task.sourceKind, "local_video");
  assert.equal(task.sourceUrl, "");
  assert.equal(task.platform, undefined);
  assert.equal(metadata.title, "口播原片.mp4");
  assert.equal(metadata.sourceKind, "local_video");
  assert.equal(adapterCalled, false);
  assert.equal(downloaderCalled, false);
  assert.match(setup.store.values.get(paths.transcript) ?? "", /原始文稿/u);
  assert.deepEqual(new Set(setup.events.map((event) => event.stage)), new Set([
    "detect-platform", "resolve-link", "parse-content", "select-media", "download-media", "obtain-transcript", "save-artifacts",
  ]));
});

test("分离媒体下载分别标明视频流和音频流", async () => {
  const setup = dependencies(true, true);

  const result = await new IngestPipeline(setup.dependencies).run({ input: "https://www.douyin.com/video/1" });

  assert.equal(result.status, "succeeded");
  const downloadMessages = setup.events
    .filter((event) => event.stage === "download-media" && event.status === "running")
    .map((event) => event.message);
  assert.ok(downloadMessages.includes("视频流下载 100%"));
  assert.ok(downloadMessages.includes("音频流下载 100%"));
});

test("快手风控失败保存安全诊断投影", async () => {
  const setup = dependencies(true);
  const adapter: PlatformAdapter = {
    platform: "kuaishou",
    supportLevel: "experimental",
    matches: () => true,
    resolve: async (url) => ({
      sourceUrl: url,
      finalUrl: "https://www.kuaishou.com/short-video/riskcase?signature=secret",
      status: 200,
    }),
    parse: async () => {
      throw new TaskError({
        code: "PLATFORM_RISK_CONTROLLED",
        message: "快手平台触发风控，暂时无法获取视频",
        action: "wait_and_retry",
        retryable: true,
        details: { operationName: "visionVideoDetail", httpStatus: 200, graphqlErrorCount: 1 },
      });
    },
  };
  const result = await new IngestPipeline({ ...setup.dependencies, adapters: [adapter] }).run({
    input: "https://v.kuaishou.com/riskcase",
  });
  const raw = setup.store.values.get(paths.rawResponse) ?? "";
  assert.equal(result.status, "failed");
  assert.match(raw, /"operationName":"visionVideoDetail"/);
  assert.match(raw, /"errorCode":"PLATFORM_RISK_CONTROLLED"/);
  assert.doesNotMatch(raw, /signature|secret/);
});

test("原生链接超时保持在resolve-link且持久化投影不含输入query或原始异常", async () => {
  const setup = dependencies(true);
  const adapter: PlatformAdapter = {
    platform: "douyin",
    supportLevel: "stable",
    matches: () => true,
    resolve: async () => {
      throw new TaskError({
        code: "LINK_TIMEOUT",
        message: "页面抓取超时，请检查网络后重试",
        action: "check_network",
        retryable: true,
        details: { nativeCode: "ERR_LINK_TIMEOUT" },
        diagnostic: {
          schemaVersion: "native-link-diagnostic.v1",
          operation: "fetch-text",
          phase: "response",
          hostname: "www.douyin.com",
          errorClass: "timeout",
          elapsedMs: 30_000,
          attempt: 2,
          redirectCount: 1,
        },
      });
    },
    parse: async () => { throw new Error("parse must not run"); },
  };

  const result = await new IngestPipeline({ ...setup.dependencies, adapters: [adapter] }).run({
    input: "https://www.douyin.com/video/1?token=query-secret",
  });
  const persisted = [...setup.store.values.values()].join("\n");
  const task = JSON.parse(setup.store.values.get(paths.task) ?? "{}") as {
    readonly currentStage?: string;
    readonly sourceUrl?: string;
    readonly issues?: readonly { readonly diagnostic?: { readonly schemaVersion?: string } }[];
  };

  assert.equal(result.status, "failed");
  assert.equal(result.issues[0]?.stage, "resolve-link");
  assert.equal(result.issues[0]?.code, "LINK_TIMEOUT");
  assert.equal(result.issues[0]?.diagnostic?.schemaVersion, "native-link-diagnostic.v1");
  assert.equal(task.currentStage, "resolve-link");
  assert.equal(task.sourceUrl, "https://www.douyin.com/video/1");
  assert.equal(task.issues?.[0]?.diagnostic?.schemaVersion, "native-link-diagnostic.v1");
  assert.doesNotMatch(persisted, /query-secret|token=|Cookie|Authorization|SocketTimeoutException|raw native/);
});

test("平台结构变化和无媒体保持既有业务码而不被映射成链接网络错误", async () => {
  const schemaSetup = dependencies(true);
  const schemaAdapter: PlatformAdapter = {
    platform: "douyin",
    supportLevel: "stable",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "<html>changed</html>" }),
    parse: async () => {
      throw new TaskError({ code: "CONTENT_SCHEMA_CHANGED", message: "页面结构已经变化", action: "retry" });
    },
  };
  const schemaResult = await new IngestPipeline({ ...schemaSetup.dependencies, adapters: [schemaAdapter] }).run({
    input: "https://www.douyin.com/video/1",
  });
  const noMediaResult = await new IngestPipeline(dependencies(false).dependencies).run({
    input: "https://www.douyin.com/video/1",
  });

  assert.equal(schemaResult.issues[0]?.code, "CONTENT_SCHEMA_CHANGED");
  assert.equal(schemaResult.issues[0]?.stage, "parse-content");
  assert.equal(noMediaResult.issues[0]?.code, "MEDIA_SOURCE_NOT_FOUND");
  assert.equal(noMediaResult.issues.some((issue) => issue.code === "LINK_NETWORK_FAILED"), false);
});
test("成功落盘只保留白名单投影且不写整页HTML", async () => {
  const setup = dependencies(true);
  const result = await new IngestPipeline(setup.dependencies).run({ input: "https://www.douyin.com/video/1" });
  const persisted = JSON.parse(setup.store.values.get(paths.rawResponse) ?? "{}") as {
    readonly platform?: string;
    readonly id?: string;
    readonly contentType?: string;
    readonly httpStatus?: number;
    readonly hasAuthor?: boolean;
    readonly hasTitle?: boolean;
    readonly media?: {
      readonly videoCount?: number;
      readonly audioCount?: number;
      readonly imageCount?: number;
      readonly candidates?: readonly { readonly host?: string; readonly path?: string }[];
    };
  };

  assert.equal(result.status, "succeeded");
  assert.equal(setup.store.values.has(paths.rawPage), false);
  assert.equal(persisted.platform, "douyin");
  assert.equal(persisted.id, "synthetic-aweme-1");
  assert.equal(persisted.contentType, "video");
  assert.equal(persisted.httpStatus, 200);
  assert.equal(persisted.hasAuthor, true);
  assert.equal(persisted.hasTitle, true);
  assert.equal(persisted.media?.videoCount, 1);
  assert.equal(persisted.media?.audioCount, 0);
  assert.equal(persisted.media?.imageCount, 0);
  assert.deepEqual(persisted.media?.candidates, [{ host: "media.example", path: "/video.mp4" }]);
  assert.deepEqual(Object.keys(persisted).sort(), [
    "contentType", "hasAuthor", "hasTitle", "httpStatus", "id", "media", "platform",
  ]);
  assert.deepEqual(Object.keys(persisted.media ?? {}).sort(), [
    "audioCount", "candidates", "imageCount", "videoCount",
  ]);
});

test("没有视频源时返回降级并保存任务", async () => {
  const setup = dependencies(false);
  let downloaderCalled = false;
  let transcriberCalled = false;
  const result = await new IngestPipeline({
    ...setup.dependencies,
    downloader: { download: async () => { downloaderCalled = true; } },
    transcriber: { transcribe: async () => { transcriberCalled = true; return { status: "failed", text: "", segments: [] }; } },
  }).run({ input: "https://www.douyin.com/note/1" });
  const latest = assertSevenStagesTerminal(setup.events);
  const task = JSON.parse(setup.store.values.get(paths.task) ?? "{}") as { readonly status?: string };

  assert.equal(result.status, "degraded");
  assert.equal(result.videoPath, undefined);
  assert.ok(setup.store.values.has(paths.task));
  assert.equal(task.status, "degraded");
  assert.equal(downloaderCalled, false);
  assert.equal(transcriberCalled, false);
  assert.equal(latest.get("select-media")?.status, "degraded");
  assert.equal(latest.get("download-media")?.status, "succeeded");
  assert.equal(latest.get("download-media")?.message, "无视频源，无需下载");
  assert.equal(latest.get("obtain-transcript")?.status, "succeeded");
  assert.equal(latest.get("obtain-transcript")?.message, "无视频源，无需转写");
  assert.equal(latest.get("save-artifacts")?.status, "succeeded");
  assert.equal(setup.events.some((event) => event.stage === "download-media" && /下载 \d+%/.test(event.message)), false);
});

test("解析链接或内容早期失败后后续阶段都有可解释终态", async () => {
  const resolveSetup = dependencies(true);
  const resolveBase = resolveSetup.dependencies.adapters[0]!;
  const resolveResult = await new IngestPipeline({
    ...resolveSetup.dependencies,
    adapters: [{
      ...resolveBase,
      resolve: async () => {
        throw new TaskError({ code: "LINK_TIMEOUT", message: "页面抓取超时，请检查网络后重试", action: "check_network" });
      },
    }],
  }).run({ input: "https://www.douyin.com/video/1" });
  const resolveLatest = assertSevenStagesTerminal(resolveSetup.events);
  const resolveTask = JSON.parse(resolveSetup.store.values.get(paths.task) ?? "{}") as {
    readonly status?: string;
    readonly currentStage?: string;
  };

  assert.equal(resolveResult.status, "failed");
  assert.equal(resolveTask.status, "failed");
  assert.equal(resolveTask.currentStage, "resolve-link");
  assert.equal(resolveLatest.get("detect-platform")?.status, "succeeded");
  assert.equal(resolveLatest.get("resolve-link")?.status, "failed");
  for (const stage of ["parse-content", "select-media", "download-media", "obtain-transcript", "save-artifacts"] as const) {
    assert.equal(resolveLatest.get(stage)?.status, "succeeded");
    assert.equal(resolveLatest.get(stage)?.message, "上游阶段已失败，已跳过");
  }

  const parseSetup = dependencies(true);
  const parseBase = parseSetup.dependencies.adapters[0]!;
  const parseResult = await new IngestPipeline({
    ...parseSetup.dependencies,
    adapters: [{
      ...parseBase,
      parse: async () => {
        throw new TaskError({ code: "CONTENT_SCHEMA_CHANGED", message: "页面结构已经变化", action: "retry" });
      },
    }],
  }).run({ input: "https://www.douyin.com/video/1" });
  const parseLatest = assertSevenStagesTerminal(parseSetup.events);
  const parseTask = JSON.parse(parseSetup.store.values.get(paths.task) ?? "{}") as {
    readonly status?: string;
    readonly currentStage?: string;
  };

  assert.equal(parseResult.status, "failed");
  assert.equal(parseTask.status, "failed");
  assert.equal(parseTask.currentStage, "parse-content");
  assert.equal(parseLatest.get("parse-content")?.status, "failed");
  for (const stage of ["select-media", "download-media", "obtain-transcript", "save-artifacts"] as const) {
    assert.equal(parseLatest.get(stage)?.status, "succeeded");
    assert.equal(parseLatest.get(stage)?.message, "上游阶段已失败，已跳过");
  }
});

test("小红书图文保存正文和全部图片后正常成功", async () => {
  const events: ProgressEvent[] = [];
  const store = new MemoryStore();
  let transcriberCalled = false;
  const adapter: PlatformAdapter = {
    platform: "xiaohongshu",
    supportLevel: "stable",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "<html></html>" }),
    parse: async (link) => ({
      platform: "xiaohongshu",
      contentType: "image_text",
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: "图文标题",
      description: "图文正文",
      videos: [], audios: [], subtitles: [],
      images: [
        { kind: "image", url: "https://image.example/1.jpg" },
        { kind: "image", url: "https://image.example/2.jpg" },
      ],
      raw: { ok: true },
    }),
  };
  const result = await new IngestPipeline({
    adapters: [adapter],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader: { download: async (_source, _destination, progress) => { await progress?.({ downloadedBytes: 10, totalBytes: 10, progress: 1 }); } },
    mediaTools: { merge: async () => {}, probeDuration: async () => 1, extractAudio: async () => {}, splitAudio: async () => [] },
    transcriber: { transcribe: async () => { transcriberCalled = true; return { status: "failed", text: "", segments: [] }; } },
    store,
    reporter: { report: (event) => { events.push(event); } },
  }).run({ input: "小红书分享 xhslink.cn/o/image-note" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.contentType, "image_text");
  assert.equal(result.imagePaths?.length, 2);
  assert.match(store.values.get(paths.contentText) ?? "", /图文正文/);
  assert.equal(transcriberCalled, false);
  assert.equal(events.some((event) => event.stage === "obtain-transcript" && event.status === "succeeded"), true);
  assert.equal(events.some((event) => event.message === "图片下载 100%"), true);
});

test("视频无有效口播时任务成功且不生成伪文稿和整理稿", async () => {
  const setup = dependencies(true);
  let rewriterCalled = false;
  const segment = { index: 0, startSeconds: 0, endSeconds: 10, text: "", status: "no_speech" as const };
  const result = await new IngestPipeline({
    ...setup.dependencies,
    transcriber: { transcribe: async (_paths, _seconds, callback) => {
      await callback?.(segment, 1, 1);
      return { status: "no_speech", text: "", segments: [segment] };
    } },
    rewriter: { rewrite: async () => { rewriterCalled = true; return "不应生成"; } },
  }).run({ input: "https://www.douyin.com/video/1" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.speechStatus, "no_speech");
  assert.equal(result.transcriptPath, undefined);
  assert.equal(result.draftPath, undefined);
  assert.equal(rewriterCalled, false);
  assert.equal(setup.store.values.has(paths.transcript), false);
  assert.equal(setup.store.values.has(paths.draft), false);
  assert.match(setup.store.values.get(paths.transcriptJson) ?? "", /"speechStatus":"no_speech"/);
  assert.equal(result.issues.length, 0);
  assert.equal(setup.events.some((event) => event.stage === "obtain-transcript" && event.status === "running" && event.progress === 1), true);
});

test("ASR全失败并使用平台描述时记录真实来源为description", async () => {
  const setup = dependencies(true);
  const failedSegment = {
    index: 0,
    startSeconds: 0,
    endSeconds: 10,
    text: "",
    status: "failed" as const,
  };
  const result = await new IngestPipeline({
    ...setup.dependencies,
    transcriber: {
      transcribe: async () => ({ status: "failed", text: "", segments: [failedSegment] }),
    },
  }).run({ input: "https://www.douyin.com/video/1" });
  const transcriptJson = JSON.parse(setup.store.values.get(paths.transcriptJson) ?? "{}") as { source?: string };
  assert.equal(result.status, "degraded");
  assert.equal(transcriptJson.source, "description");
  assert.match(setup.store.values.get(paths.transcript) ?? "", /平台描述/);
});

test("小红书部分图片下载失败时保留正文并结构化降级", async () => {
  const store = new MemoryStore();
  let downloads = 0;
  const adapter: PlatformAdapter = {
    platform: "xiaohongshu",
    supportLevel: "stable",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "" }),
    parse: async (link) => ({
      platform: "xiaohongshu", contentType: "image_text", sourceUrl: link.sourceUrl,
      title: "标题", description: "正文", videos: [], audios: [], subtitles: [], raw: {},
      images: [{ kind: "image", url: "https://image.example/1.jpg" }, { kind: "image", url: "https://image.example/2.jpg" }],
    }),
  };
  const result = await new IngestPipeline({
    adapters: [adapter],
    http: {
      get: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      post: async () => ({ url: "", status: 200, headers: {}, body: "" }),
    },
    downloader: { download: async () => { downloads += 1; if (downloads === 2) throw new Error("network"); } },
    mediaTools: { merge: async () => {}, probeDuration: async () => 1, extractAudio: async () => {}, splitAudio: async () => [] },
    store, reporter: { report: () => {} },
  }).run({ input: "https://xhslink.cn/o/image-note" });
  assert.equal(result.status, "degraded");
  assert.equal(result.imagePaths?.length, 1);
  assert.equal(result.issues.some((issue) => issue.code === "MEDIA_DOWNLOAD_FAILED"), true);
});
