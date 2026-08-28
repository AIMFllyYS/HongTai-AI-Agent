import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateScriptSentenceMs,
  MAX_SCRIPT_SENTENCE_CHARACTERS,
  parseScriptStoryboard,
  SCRIPT_SENTENCE_MS_PER_CHARACTER,
  SCRIPT_STORYBOARD_CONTRACT_VERSION,
  scriptStoryboardEstimatedTotalMs,
  type ScriptStoryboard,
} from "../packages/core/src/index";

test("分镜脚本契约版本固定，变更必须显式推进", () => {
  assert.equal(SCRIPT_STORYBOARD_CONTRACT_VERSION, "script-storyboard.v1");
});

test("预估时长按字符估算，只用于生成阶段展示", () => {
  assert.equal(SCRIPT_SENTENCE_MS_PER_CHARACTER, 250);
  assert.equal(estimateScriptSentenceMs("到店看过程"), 1_250);
  assert.equal(estimateScriptSentenceMs("  到店看过程  "), 1_250, "前后空白不计时");
  assert.equal(estimateScriptSentenceMs(""), 0);
});

test("预估总时长是逐句预估之和", () => {
  const storyboard: ScriptStoryboard = {
    schemaVersion: "script-storyboard.v1",
    sentences: [
      { id: "sentence-1", text: "第一次到店总是没底。", estimatedMs: 2_500 },
      { id: "sentence-2", text: "我们把真实步骤拍下来。", estimatedMs: 2_750 },
    ],
  };
  assert.equal(scriptStoryboardEstimatedTotalMs(storyboard), 5_250);
});

test("解析接受完整分镜脚本，可选字段与整体用途一并保留", () => {
  const parsed = parseScriptStoryboard({
    schemaVersion: "script-storyboard.v1",
    purpose: "门店服务介绍",
    sentences: [
      {
        id: "sentence-1",
        text: "第一次到店总是没底。",
        assetId: "asset-image",
        stickerId: "star_mark",
        estimatedMs: 2_500,
      },
      { id: "sentence-2", text: "我们把真实步骤拍下来。", estimatedMs: 2_750 },
    ],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.purpose, "门店服务介绍");
  assert.equal(parsed.value.sentences.length, 2);
  assert.deepEqual(parsed.value.sentences[0], {
    id: "sentence-1",
    text: "第一次到店总是没底。",
    assetId: "asset-image",
    stickerId: "star_mark",
    estimatedMs: 2_500,
  });
  assert.deepEqual(parsed.value.sentences[1], {
    id: "sentence-2",
    text: "我们把真实步骤拍下来。",
    estimatedMs: 2_750,
  });
});

test("解析接受省略可选字段的最小分镜脚本", () => {
  const parsed = parseScriptStoryboard({
    schemaVersion: "script-storyboard.v1",
    sentences: [{ id: "sentence-1", text: "欢迎到店了解。", estimatedMs: 1_500 }],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.purpose, undefined);
  assert.deepEqual(parsed.value.sentences, [
    { id: "sentence-1", text: "欢迎到店了解。", estimatedMs: 1_500 },
  ]);
});

test("非法输入返回稳定错误码，而不是抛异常", () => {
  const cases: readonly { readonly value: unknown; readonly code: string }[] = [
    { value: null, code: "SCRIPT_STORYBOARD_UNREADABLE" },
    { value: "不是对象", code: "SCRIPT_STORYBOARD_UNREADABLE" },
    { value: { schemaVersion: "script-storyboard.v2", sentences: [] }, code: "SCRIPT_STORYBOARD_VERSION_UNSUPPORTED" },
    { value: { schemaVersion: "script-storyboard.v1" }, code: "SCRIPT_STORYBOARD_SENTENCES_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [] }, code: "SCRIPT_STORYBOARD_SENTENCES_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: "句子不是数组" }, code: "SCRIPT_STORYBOARD_SENTENCES_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", purpose: 42, sentences: [{ id: "s1", text: "文案", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_PURPOSE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: ["句子不是对象"] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ text: "没有id", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "", text: "空id", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "  ", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "明".repeat(MAX_SCRIPT_SENTENCE_CHARACTERS + 1), estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "文案", estimatedMs: 0 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "文案", estimatedMs: Number.NaN }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "文案", assetId: "  ", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
    { value: { schemaVersion: "script-storyboard.v1", sentences: [{ id: "s1", text: "文案", stickerId: "不存在的贴纸", estimatedMs: 1 }] }, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID" },
  ];

  for (const { value, code } of cases) {
    const parsed = parseScriptStoryboard(value);
    assert.equal(parsed.ok, false, `输入应被拒绝：${JSON.stringify(value)}`);
    if (parsed.ok) continue;
    assert.equal(parsed.code, code, `错误码必须稳定，期望 ${code}`);
    assert.ok(parsed.message.length > 0, "拒绝时必须给出可展示的中文说明");
  }
});

test("句子 id 必须唯一，重复时按稳定错误码拒绝", () => {
  const parsed = parseScriptStoryboard({
    schemaVersion: "script-storyboard.v1",
    sentences: [
      { id: "sentence-1", text: "第一句。", estimatedMs: 1_000 },
      { id: "sentence-1", text: "第二句。", estimatedMs: 1_000 },
    ],
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "SCRIPT_STORYBOARD_SENTENCE_ID_DUPLICATED");
});

test("解析结果可直接进入就绪检查：合法脚本保留句子顺序", () => {
  const parsed = parseScriptStoryboard({
    schemaVersion: "script-storyboard.v1",
    sentences: [
      { id: "a", text: "第一句。", estimatedMs: 1_000 },
      { id: "b", text: "第二句。", estimatedMs: 1_200 },
      { id: "c", text: "第三句。", estimatedMs: 900 },
    ],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.sentences.map((sentence) => sentence.id), ["a", "b", "c"]);
});
