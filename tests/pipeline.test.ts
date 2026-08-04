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
}

function dependencies(withVideo: boolean): { dependencies: IngestPipelineDependencies; events: ProgressEvent[]; store: MemoryStore } {
  const events: ProgressEvent[] = [];
  const store = new MemoryStore();
  const adapter: PlatformAdapter = {
    platform: "douyin",
    matches: () => true,
    resolve: async (url) => ({ sourceUrl: url, finalUrl: url, status: 200, body: "<html></html>" }),
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
        return [segment];
      } },
      rewriter: { rewrite: async () => "整理文稿" },
      reporter: { report: (event) => { events.push(event); } },
    },
  };
}

test("完整流水线覆盖七个阶段并保留两种文稿", async () => {
  const setup = dependencies(true);
  const result = await new IngestPipeline(setup.dependencies).run({ input: "https://www.douyin.com/video/1" });
  assert.equal(result.status, "succeeded");
  assert.ok(result.videoPath);
  assert.match(setup.store.values.get(paths.transcript) ?? "", /原始文稿/);
  assert.match(setup.store.values.get(paths.draft) ?? "", /整理文稿/);
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
