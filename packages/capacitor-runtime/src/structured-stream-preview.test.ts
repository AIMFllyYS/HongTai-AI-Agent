import assert from "node:assert/strict";
import test from "node:test";

import { StructuredStreamPreview } from "./structured-stream-preview.js";

test("structured stream preview exposes whitelisted content-analysis drafts without raw JSON or reasoning", () => {
  const preview = new StructuredStreamPreview("content-analysis");
  const receiving = preview.append('{"overview":{"summary":"真实内容概览"},"hook":{"description":"开场拆解"}}');

  assert.equal(receiving.phase, "receiving");
  assert.equal(receiving.receivedCharacters > 0, true);
  assert.deepEqual(receiving.sections, ["内容概览", "开场机制"]);
  assert.deepEqual(receiving.highlights, [{ label: "内容概览", value: "真实内容概览" }, { label: "开场拆解", value: "开场拆解" }]);
  assert.doesNotMatch(JSON.stringify(receiving), /reasoning|\{"overview/u);

  const validating = preview.completeProviderResponse();
  assert.equal(validating.phase, "validating");

  const repaired = preview.append('{"risks":[]}');
  assert.equal(repaired.phase, "repairing");
  assert.deepEqual(repaired.sections, ["风险提示"]);
});

test("diagnosis preview only exposes safe section labels", () => {
  const preview = new StructuredStreamPreview("diagnosis-report");
  const progress = preview.append('{"imageQuality":{},"observations":[{"description":"private medical draft"}]}');

  assert.deepEqual(progress.sections, ["图片质量", "可见观察"]);
  assert.deepEqual(progress.highlights, []);
  assert.doesNotMatch(JSON.stringify(progress), /private medical draft/u);
});
