import assert from "node:assert/strict";
import test from "node:test";

import type { MediaReference, TaskRecord } from "@hongtai/core";

import { projectTaskDetail, projectTaskMedia } from "./standalone-task-detail-projection.js";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
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

test("projectTaskDetail maps legal engagement integers from metadata", () => {
  const detail = projectTaskDetail(task(), [], {
    title: "真实标题",
    likeCount: 128,
    favoriteCount: 64,
    commentCount: 32,
    shareCount: 16,
    playCount: 4096,
  }, undefined, undefined, undefined);
  assert.equal(detail.content.likeCount, 128);
  assert.equal(detail.content.favoriteCount, 64);
  assert.equal(detail.content.commentCount, 32);
  assert.equal(detail.content.shareCount, 16);
  assert.equal(detail.content.playCount, 4096);
});

test("projectTaskDetail omits fake, negative, and non-integer engagement values", () => {
  const detail = projectTaskDetail(task(), [], {
    likeCount: "1.2w",
    favoriteCount: "2.4万",
    commentCount: -1,
    shareCount: 12.5,
    playCount: Number.NaN,
  }, undefined, undefined, undefined);
  assert.equal(detail.content.likeCount, undefined);
  assert.equal(detail.content.favoriteCount, undefined);
  assert.equal(detail.content.commentCount, undefined);
  assert.equal(detail.content.shareCount, undefined);
  assert.equal(detail.content.playCount, undefined);
});

test("projectTaskDetail leaves local-upload metadata without engagement counts", () => {
  const detail = projectTaskDetail(task({
    sourceKind: "local_video",
    sourceUrl: "",
    platform: undefined,
  }), [], { sourceKind: "local_video", contentType: "video", title: "口播原片.mp4" }, undefined, undefined, undefined);
  assert.equal(detail.content.title, "口播原片.mp4");
  assert.equal(detail.content.likeCount, undefined);
  assert.equal(detail.content.favoriteCount, undefined);
  assert.equal(detail.content.commentCount, undefined);
  assert.equal(detail.content.shareCount, undefined);
  assert.equal(detail.content.playCount, undefined);
});

test("projectTaskDetail prefers the persisted first frame over the stored video and the remote cover", () => {
  const video: MediaReference = { uri: "capacitor://localhost/private/tasks/task-1/media/video.mp4", kind: "video", origin: "downloaded", displayName: "下载的视频" };
  const thumbnail: MediaReference = { uri: "capacitor://localhost/private/tasks/task-1/media/thumbnail.jpg", kind: "image", origin: "downloaded", mimeType: "image/jpeg", displayName: "视频首帧" };
  const detail = projectTaskDetail(task(), [video, thumbnail], { coverUrl: "https://cdn.example/cover.jpg?signature=secret#frame" }, undefined, undefined, undefined);
  assert.equal(detail.content.cover?.uri, thumbnail.uri);
  assert.equal(detail.content.cover?.kind, "image");
});

test("projectTaskDetail prefers the stored video over the remote cover when no first frame exists", () => {
  const video: MediaReference = { uri: "capacitor://localhost/private/tasks/task-1/media/video.mp4", kind: "video", origin: "downloaded", displayName: "解析视频" };
  const detail = projectTaskDetail(task(), [video], { coverUrl: "https://cdn.example/cover.jpg?signature=secret#frame" }, undefined, undefined, undefined);
  assert.equal(detail.content.cover?.uri, video.uri);
  assert.equal(detail.content.cover?.kind, "video");
});

test("projectTaskDetail falls back to a safe remote cover only when neither the first frame nor the stored video exists", () => {
  const remote = projectTaskDetail(task(), [], { coverUrl: "https://cdn.example/cover.jpg?signature=secret#frame" }, undefined, undefined, undefined);
  assert.deepEqual(remote.content.cover, {
    uri: "https://cdn.example/cover.jpg",
    kind: "image",
    origin: "downloaded",
    mimeType: "image/jpeg",
    displayName: "视频封面",
  });
});

test("projectTaskMedia resolves the persisted first frame after the stored video", async () => {
  const files = {
    getUri: async ({ relativePath }: { readonly taskId: string; readonly relativePath: string }) => {
      if (relativePath === "media/video.mp4") return { uri: "file:///private/tasks/task-1/media/video.mp4", sizeBytes: 128, mimeType: "video/mp4" };
      if (relativePath === "media/thumbnail.jpg") return { uri: "file:///private/tasks/task-1/media/thumbnail.jpg", sizeBytes: 16, mimeType: "image/jpeg" };
      return {};
    },
  };
  const media = await projectTaskMedia(task(), files, (uri) => `display:${uri}`, async () => undefined);
  assert.deepEqual(media.map((item) => [item.kind, item.displayName]), [["video", "下载的视频"], ["image", "视频首帧"]]);
  assert.equal(media[1]?.uri, "display:file:///private/tasks/task-1/media/thumbnail.jpg");
  assert.equal(media[1]?.origin, "downloaded");
  assert.equal(media[1]?.mimeType, "image/jpeg");
});

test("projectTaskMedia keeps the imported origin on a local video's first frame and skips a missing one", async () => {
  const files = {
    getUri: async ({ relativePath }: { readonly taskId: string; readonly relativePath: string }) => {
      if (relativePath === "media/video.mp4") return { uri: "file:///private/tasks/task-1/media/video.mp4", sizeBytes: 128, mimeType: "video/mp4" };
      return {};
    },
  };
  const withThumbnail = await projectTaskMedia(
    task({ sourceKind: "local_video", sourceUrl: "", platform: undefined }),
    {
      getUri: async ({ relativePath }) => {
        if (relativePath === "media/video.mp4") return { uri: "file:///private/tasks/task-1/media/video.mp4", sizeBytes: 128, mimeType: "video/mp4" };
        if (relativePath === "media/thumbnail.jpg") return { uri: "file:///private/tasks/task-1/media/thumbnail.jpg", sizeBytes: 16 };
        return {};
      },
    },
    (uri) => uri,
    async () => undefined,
  );
  assert.deepEqual(withThumbnail.map((item) => [item.kind, item.origin]), [["video", "imported"], ["image", "imported"]]);

  const withoutThumbnail = await projectTaskMedia(task(), files, (uri) => uri, async () => undefined);
  assert.deepEqual(withoutThumbnail.map((item) => item.kind), ["video"]);
});
