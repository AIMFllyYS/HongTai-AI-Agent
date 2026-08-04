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
import { IngestPipeline } from "../packages/core/src/index";

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

class MemoryStore implements ArtifactStore {
  readonly values = new Map<string, string>();
  async initializeTask(): Promise<TaskPaths> { return paths; }
  async writeJson(path: string, value: unknown): Promise<void> { this.values.set(path, JSON.stringify(value)); }
  async writeText(path: string, value: string): Promise<void> { this.values.set(path, value); }
  async appendText(path: string, value: string): Promise<void> { this.values.set(path, (this.values.get(path) ?? "") + value); }
  imagePath(_paths: TaskPaths, index: number): string { return `task/media/images/image-${index + 1}.jpg`; }
}

function dependencies(withVideo: boolean): { dependencies: IngestPipelineDependencies; events: ProgressEvent[]; store: MemoryStore } {
  const events: ProgressEvent[] = [];
  const store = new MemoryStore();
  const adapter: PlatformAdapter = {
    platform: "douyin",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: `${url}?xsec_token=private-token`, status: 200, body: "<html></html>" }),
    parse: async (link) => ({
      platform: "douyin",
      contentType: "video",
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: "测试",
      description: "平台描述",
      videos: withVideo ? [{ kind: "video", url: "https://media.example/video.mp4", hasWatermark: false }] : [],
      audios: [],
      images: [],
      subtitles: [],
      raw: { ok: true },
    }),
  };
  const http: HttpClient = { get: async () => ({ url: "", status: 200, headers: {}, body: "" }) };
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
  assert.equal(setup.events.find((event) => event.stage === "detect-platform" && event.status === "succeeded")?.detail?.ignoredSupportedUrlCount, 1);
  assert.deepEqual(new Set(setup.events.map((event) => event.stage)), new Set([
    "detect-platform", "resolve-link", "parse-content", "select-media", "download-media", "obtain-transcript", "save-artifacts",
  ]));
});
test("没有视频源时返回降级并保存任务", async () => {
  const setup = dependencies(false);
  const result = await new IngestPipeline(setup.dependencies).run({ input: "https://www.douyin.com/note/1" });
  assert.equal(result.status, "degraded");
  assert.equal(result.videoPath, undefined);
  assert.ok(setup.store.values.has(paths.task));
});

test("小红书图文保存正文和全部图片后正常成功", async () => {
  const events: ProgressEvent[] = [];
  const store = new MemoryStore();
  let transcriberCalled = false;
  const adapter: PlatformAdapter = {
    platform: "xiaohongshu",
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
    http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
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
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "" }),
    parse: async (link) => ({
      platform: "xiaohongshu", contentType: "image_text", sourceUrl: link.sourceUrl,
      title: "标题", description: "正文", videos: [], audios: [], subtitles: [], raw: {},
      images: [{ kind: "image", url: "https://image.example/1.jpg" }, { kind: "image", url: "https://image.example/2.jpg" }],
    }),
  };
  const result = await new IngestPipeline({
    adapters: [adapter], http: { get: async () => ({ url: "", status: 200, headers: {}, body: "" }) },
    downloader: { download: async () => { downloads += 1; if (downloads === 2) throw new Error("network"); } },
    mediaTools: { merge: async () => {}, probeDuration: async () => 1, extractAudio: async () => {}, splitAudio: async () => [] },
    store, reporter: { report: () => {} },
  }).run({ input: "https://xhslink.cn/o/image-note" });
  assert.equal(result.status, "degraded");
  assert.equal(result.imagePaths?.length, 1);
  assert.equal(result.issues.some((issue) => issue.code === "MEDIA_DOWNLOAD_FAILED"), true);
});
