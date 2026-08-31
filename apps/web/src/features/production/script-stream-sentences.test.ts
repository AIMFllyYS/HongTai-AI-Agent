import assert from "node:assert/strict";
import test from "node:test";

import { SCRIPT_SENTENCE_MS_PER_CHARACTER } from "@hongtai/core";

import { extractClosedStreamSentences } from "./script-stream-sentences";

test("流式句子提取：只认完整闭合且字段合法的句子对象", () => {
  // 正常：两句闭合，第三句半截（对象未闭合）不提取。
  const partial = `{"sentences": [
    {"id": "s1", "text": "第一句口播文案", "stickerId": "star_mark", "estimatedMs": 2500},
    {"id": "s2", "text": "第二句口播文案", "estimatedMs": 3000},
    {"id": "s3", "text": "第三句还没写完`;
  const sentences = extractClosedStreamSentences(partial);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0]?.text, "第一句口播文案");
  assert.equal(sentences[0]?.stickerId, "star_mark");
  assert.equal(sentences[0]?.estimatedMs, 2500);
  assert.equal(sentences[1]?.text, "第二句口播文案");
  assert.equal(sentences[1]?.stickerId, undefined);

  // 目录外 stickerId 视为无贴纸，不猜、不硬上屏。
  const badSticker = extractClosedStreamSentences(`{"sentences": [{"text": "带贴纸的句子", "stickerId": "not_in_catalogue"}]}`);
  assert.equal(badSticker.length, 1);
  assert.equal(badSticker[0]?.stickerId, undefined);

  // 缺 estimatedMs：按 250ms/字估算（与 core 口径一致）。
  const noEstimate = extractClosedStreamSentences(`{"sentences": [{"text": "四个字幕"}]}`);
  assert.equal(noEstimate[0]?.estimatedMs, 4 * SCRIPT_SENTENCE_MS_PER_CHARACTER);
  // estimatedMs 非法（0/负数/非数字）同样退回字数估算。
  const badEstimate = extractClosedStreamSentences(`{"sentences": [{"text": "四个字幕", "estimatedMs": 0}]}`);
  assert.equal(badEstimate[0]?.estimatedMs, 4 * SCRIPT_SENTENCE_MS_PER_CHARACTER);

  // 缺 text 或 text 为空：跳过。
  assert.equal(extractClosedStreamSentences(`{"sentences": [{"estimatedMs": 1000}]}`).length, 0);
  assert.equal(extractClosedStreamSentences(`{"sentences": [{"text": "  "}]}`).length, 0);
});

test("流式句子提取：半截 JSON、字符串内括号与截断窗口都不误判", () => {
  // 完全未闭合：一句也提不出来。
  assert.equal(extractClosedStreamSentences(`{"sentences": [{"text": "还在生成`).length, 0);
  // 空输入与非 JSON 文本。
  assert.equal(extractClosedStreamSentences("").length, 0);
  assert.equal(extractClosedStreamSentences("正在思考…").length, 0);

  // 字符串里的花括号与转义引号不参与配对：句子照常闭合提取。
  const tricky = `{"sentences": [{"text": "带括号{和}还有\\"引号\\"的句子", "estimatedMs": 2000}]}`;
  const trickySentences = extractClosedStreamSentences(tricky);
  assert.equal(trickySentences.length, 1);
  assert.equal(trickySentences[0]?.text, "带括号{和}还有\"引号\"的句子");

  // 4000 字符截头保尾边界：残留窗口中段起、没有根对象头与 "sentences" 键，
  // 闭合句依然提取（不补被截掉的头部句）。截点落在句边界上，模拟截头后的窗口。
  const sentence = `{"id": "s", "text": "${"一".repeat(40)}", "estimatedMs": 10000},`;
  const stream = `{"sentences": [${sentence.repeat(30)}`;
  const cutAt = stream.indexOf(sentence, 2);
  assert.ok(stream.length - cutAt <= 4_000, "测试数据要落在界面截断窗口的量级内");
  const truncated = stream.slice(cutAt);
  const extracted = extractClosedStreamSentences(truncated);
  assert.ok(extracted.length > 0, "截断窗口内的闭合句必须提取");
  assert.ok(extracted.every((item) => item.text === "一".repeat(40)));
  assert.ok(extracted.every((item) => item.estimatedMs === 10_000));

  // 截点落在句中（残留半句）：半截对象未闭合被跳过，不猜结构。
  const midSentenceCut = stream.slice(cutAt + 10);
  const midExtracted = extractClosedStreamSentences(midSentenceCut);
  assert.ok(midExtracted.every((item) => item.text === "一".repeat(40)));

  // 完整流（根对象也闭合）：根对象没有顶层 text，校验跳过，只产句子。
  const complete = `{"sentences": [{"text": "第一句", "estimatedMs": 1000}, {"text": "第二句", "estimatedMs": 2000}]}`;
  assert.equal(extractClosedStreamSentences(complete).length, 2);
});
