import assert from "node:assert/strict";
import test from "node:test";

import { TaskError, type StructuredGenerationProgressV1 } from "../packages/core/src/index";
import { ReasoningProgress } from "../packages/ai/src/structured-output/reasoning-progress";
import { StructuredGenerationProgressTracker } from "../packages/ai/src/structured-output/structured-generation-progress";
import { TopLevelJsonFieldStream } from "../packages/ai/src/structured-output/top-level-json-field-stream";

test("TopLevelJsonFieldStream emits only complete selected top-level values across arbitrary chunks", () => {
  const parser = new TopLevelJsonFieldStream(["overview", "styleTemplate"]);
  const emitted = [
    ...parser.push('{"over'),
    ...parser.push('view":{"text":"中'),
    ...parser.push('文\\"内容","literal":"{not json}"},"ignored":{"x":true},"styleTemplate":{"steps":["A",{"x":1}]}'),
    ...parser.push("}"),
    ...parser.finish(),
  ];

  assert.deepEqual(emitted, [
    { key: "overview", value: { text: '中文"内容', literal: "{not json}" } },
    { key: "styleTemplate", value: { steps: ["A", { x: 1 }] } },
  ]);
});

test("TopLevelJsonFieldStream handles escaped backslashes, arrays, whitespace and an empty object", () => {
  const parser = new TopLevelJsonFieldStream(["path", "items", "empty"]);
  assert.deepEqual(parser.push(' { "path" : "C:\\\\tmp\\\\file", "items" : [1,{"text":"}"}],'), [
    { key: "path", value: "C:\\tmp\\file" },
    { key: "items", value: [1, { text: "}" }] },
  ]);
  assert.deepEqual(parser.push(' "empty" : {} }  '), [{ key: "empty", value: {} }]);
  assert.deepEqual(parser.finish(), []);
});

test("TopLevelJsonFieldStream rejects duplicates, truncation and non-object roots", () => {
  const duplicate = new TopLevelJsonFieldStream(["overview"]);
  assert.deepEqual(duplicate.push('{"overview":{"text":"first"},'), [
    { key: "overview", value: { text: "first" } },
  ]);
  assert.throws(
    () => duplicate.push('"overview":{"text":"second"}}'),
    (error) => error instanceof TaskError && error.code === "AI_STRUCTURED_OUTPUT_INVALID",
  );

  const truncated = new TopLevelJsonFieldStream(["overview"]);
  truncated.push('{"overview":{"text":"中文');
  assert.throws(
    () => truncated.finish(),
    (error) => error instanceof TaskError && error.code === "AI_STRUCTURED_OUTPUT_INVALID",
  );

  const arrayRoot = new TopLevelJsonFieldStream(["overview"]);
  assert.throws(
    () => arrayRoot.push("[]"),
    (error) => error instanceof TaskError && error.code === "AI_STRUCTURED_OUTPUT_INVALID",
  );

  const trailingComma = new TopLevelJsonFieldStream(["overview"]);
  assert.throws(
    () => trailingComma.push('{"overview":{},}'),
    (error) => error instanceof TaskError && error.code === "AI_STRUCTURED_OUTPUT_INVALID",
  );
});

test("ReasoningProgress exposes waiting, coalesced streaming and completed snapshots", () => {
  let now = 0;
  const reasoning = new ReasoningProgress({ minCharacters: 3, minIntervalMs: 500, now: () => now });

  assert.deepEqual(reasoning.snapshot(), { status: "waiting", text: "" });
  assert.deepEqual(reasoning.append("深"), { status: "streaming", text: "深" });
  assert.equal(reasoning.append("度"), undefined);
  assert.equal(reasoning.append("思"), undefined);
  assert.deepEqual(reasoning.append("考"), { status: "streaming", text: "深度思考" });
  now = 600;
  assert.deepEqual(reasoning.append("中"), { status: "streaming", text: "深度思考中" });
  assert.deepEqual(reasoning.complete(), { status: "completed", text: "深度思考中" });
  assert.equal(reasoning.complete(), undefined);
});

test("StructuredGenerationProgressTracker includes runtime-only reasoning in cumulative snapshots", async () => {
  const snapshots: StructuredGenerationProgressV1[] = [];
  const tracker = new StructuredGenerationProgressTracker(
    "diagnosis-report",
    ["visual-observations", "observation-summary"],
    (snapshot) => { snapshots.push(snapshot); },
  );

  await tracker.preparing();
  await tracker.thinkingDelta("先查看图片");
  await tracker.running("visual-observations");
  await tracker.completeThinking();

  assert.deepEqual(snapshots[0]?.thinking, { status: "waiting", text: "" });
  assert.deepEqual(snapshots.at(-1)?.thinking, { status: "completed", text: "先查看图片" });
  assert.equal(snapshots.at(-1)?.modules[0]?.status, "running");
});
