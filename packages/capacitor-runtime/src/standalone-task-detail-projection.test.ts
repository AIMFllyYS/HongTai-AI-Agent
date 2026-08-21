import assert from "node:assert/strict";
import test from "node:test";

import type { TaskRecord } from "@hongtai/core";

import { projectTaskDetail } from "./standalone-task-detail-projection.js";

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
