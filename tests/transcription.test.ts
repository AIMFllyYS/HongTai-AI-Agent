import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTranscription, type TranscriptSegment } from "../packages/core/src/index";

function segment(index: number, status: TranscriptSegment["status"], text = ""): TranscriptSegment {
  return { index, startSeconds: index * 30, endSeconds: (index + 1) * 30, status, text };
}

test("所有成功分段均为空时汇总为无口播", () => {
  const result = summarizeTranscription([segment(0, "no_speech"), segment(1, "no_speech")]);
  assert.equal(result.status, "no_speech");
  assert.equal(result.text, "");
});

test("无口播和失败分段混合时不能误判为无口播", () => {
  const result = summarizeTranscription([segment(0, "no_speech"), segment(1, "failed")]);
  assert.equal(result.status, "failed");
});

test("存在有效文字时汇总为已转写并保留失败分段", () => {
  const result = summarizeTranscription([segment(0, "succeeded", "第一段"), segment(1, "failed")]);
  assert.equal(result.status, "transcribed");
  assert.equal(result.text, "第一段");
  assert.equal(result.segments[1]?.status, "failed");
});
