import assert from "node:assert/strict";
import test from "node:test";

import { parseTtsTimedTrack, type ScriptSentence, type TtsTimedTrack } from "../packages/core/src/index";
import {
  alignNarrationWordsWithWhisper,
  buildNarrationTimingInstructionPlan,
  cleanNarrationSpeechText,
  TTS_PROVIDER_TIMING_CAPABILITIES,
  ttsProviderTimingCapability,
  whisperTranscriptEndMs,
} from "../packages/ai/src/index";

function sentence(id: string, text: string): ScriptSentence {
  return { id, text, estimatedMs: Math.max(1, [...text].length * 250) };
}

function assertTrackParseable(track: TtsTimedTrack): void {
  const parsed = parseTtsTimedTrack(track);
  if (!parsed.ok) assert.fail(`对齐产物必须满足 core 实测音轨契约：${parsed.code} ${parsed.message}`);
}

/* ============================== 能力映射 ============================== */

test("能力表按现状登记 miMo 与 stepFun，均无原生词级时间戳", () => {
  assert.equal(ttsProviderTimingCapability("mimo-chat-audio").nativeWordTimestamps, false);
  assert.equal(ttsProviderTimingCapability("stepfun-audio-speech").nativeWordTimestamps, false);
  assert.deepEqual(Object.keys(TTS_PROVIDER_TIMING_CAPABILITIES).sort(), ["mimo-chat-audio", "stepfun-audio-speech"]);
  assert.equal(Object.isFrozen(TTS_PROVIDER_TIMING_CAPABILITIES), true, "能力表是只读登记表");
});

test("能力未知的 transport 保守回退为无原生时间戳，绝不假设有能力", () => {
  assert.equal(ttsProviderTimingCapability("some-future-tts").nativeWordTimestamps, false);
  assert.equal(ttsProviderTimingCapability("").nativeWordTimestamps, false);
});

/* ============================== 指令计划构造 ============================== */

test("蒙太奇模式按能力表分派：miMo 连接的每句走 whisper 反查并需要转写", () => {
  const plan = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [sentence("s1", "到店看过程"), sentence("s2", "优惠&好礼")],
    connection: { ttsTransport: "mimo-chat-audio", ttsModel: "mimo-v2.5-tts", ttsVoice: "冰糖" },
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.value.mode, "montage");
  assert.equal(plan.value.sentences.length, 2);
  for (const instruction of plan.value.sentences) {
    assert.equal(instruction.strategy, "whisper_fallback");
    assert.equal(instruction.needsTranscription, true);
  }
  assert.equal(plan.value.sentences[1]?.speechText, "优惠和好礼", "朗读文本经过预清洗");
  assert.deepEqual(plan.value.sentences[1]?.replacements, [{ original: "&", replacement: "和", index: 2 }]);
});

test("蒙太奇模式未登记的 transport 保守走 whisper 反查", () => {
  const plan = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [sentence("s1", "欢迎光临")],
    connection: { ttsTransport: "some-future-tts" },
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.value.sentences[0]?.strategy, "whisper_fallback");
  assert.equal(plan.value.sentences[0]?.needsTranscription, true);
});

test("蒙太奇模式缺少 TTS 连接或 transport 标识时返回稳定错误", () => {
  for (const connection of [null, undefined, { ttsTransport: "  " }]) {
    const plan = buildNarrationTimingInstructionPlan({
      mode: "montage",
      sentences: [sentence("s1", "欢迎光临")],
      ...(connection === undefined ? {} : { connection }),
    });
    assert.equal(plan.ok, false, `connection=${JSON.stringify(connection)} 应被拒绝`);
    if (plan.ok) continue;
    assert.equal(plan.code, "NARRATION_TIMING_CONNECTION_INVALID");
    assert.ok(plan.message.length > 0);
  }
});

test("口播切片模式音频来自用户素材，固定 whisper 反查且不需要 TTS 连接", () => {
  const plan = buildNarrationTimingInstructionPlan({
    mode: "avatar",
    sentences: [sentence("s1", "欢迎来到我们的门店")],
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.value.mode, "avatar");
  assert.equal(plan.value.sentences[0]?.strategy, "whisper_fallback");
  assert.equal(plan.value.sentences[0]?.needsTranscription, true);
});

test("指令计划拒绝空句列表、重复 id、空 id 与空文案", () => {
  const empty = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [],
    connection: { ttsTransport: "mimo-chat-audio" },
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "NARRATION_TIMING_SENTENCES_INVALID");

  const duplicated = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [sentence("s1", "到店"), sentence("s1", "看过程")],
    connection: { ttsTransport: "mimo-chat-audio" },
  });
  assert.equal(duplicated.ok, false);
  if (!duplicated.ok) assert.equal(duplicated.code, "NARRATION_TIMING_SENTENCE_ID_DUPLICATED");

  const noId = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [sentence("  ", "到店")],
    connection: { ttsTransport: "mimo-chat-audio" },
  });
  assert.equal(noId.ok, false);
  if (!noId.ok) assert.equal(noId.code, "NARRATION_TIMING_SENTENCE_ID_INVALID");

  const noText = buildNarrationTimingInstructionPlan({
    mode: "montage",
    sentences: [sentence("s1", "  ")],
    connection: { ttsTransport: "mimo-chat-audio" },
  });
  assert.equal(noText.ok, false);
  if (!noText.ok) assert.equal(noText.code, "NARRATION_TIMING_SENTENCE_INVALID");
});

/* ============================== 预清洗与替换映射 ============================== */

test("预清洗把已知碎裂符号替换为读音等价物并记录替换映射", () => {
  const cleaning = cleanNarrationSpeechText("5折 & 到店");
  assert.equal(cleaning.speechText, "5折 和 到店");
  assert.deepEqual(cleaning.replacements, [{ original: "&", replacement: "和", index: 3 }]);
});

test("预清洗的全半角归一不改变语义，全角符号同样进入替换映射", () => {
  assert.equal(cleanNarrationSpeechText("ＡＢＣ１２３").speechText, "ABC123");
  assert.equal(cleanNarrationSpeechText("ＡＢＣ１２３").replacements.length, 0);

  const fullWidthAmpersand = cleanNarrationSpeechText("优惠＆好礼");
  assert.equal(fullWidthAmpersand.speechText, "优惠和好礼");
  assert.deepEqual(fullWidthAmpersand.replacements, [{ original: "&", replacement: "和", index: 2 }]);
});

test("预清洗剔除不可见字符并压缩空白", () => {
  assert.equal(cleanNarrationSpeechText("欢迎\u200b光临").speechText, "欢迎光临");
  assert.equal(cleanNarrationSpeechText("今天  有空").speechText, "今天 有空");
  assert.equal(cleanNarrationSpeechText("\ufeff干净").speechText, "干净");
  assert.equal(cleanNarrationSpeechText("\u200b\u200d").speechText, "");
});

/* ============================== Whisper 词对齐 ============================== */

test("正常对齐：中文逐字切词，转写合并词按词内字符比例细分", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "到店看过程",
    replacements: [],
    transcribedWords: [
      { word: "到店", startMs: 0, endMs: 600 },
      { word: "看", startMs: 600, endMs: 900 },
      { word: "过程", startMs: 900, endMs: 1_500 },
    ],
    durationMs: 1_500,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [
      { text: "到", startMs: 0, endMs: 300 },
      { text: "店", startMs: 300, endMs: 600 },
      { text: "看", startMs: 600, endMs: 900 },
      { text: "过", startMs: 900, endMs: 1_200 },
      { text: "程", startMs: 1_200, endMs: 1_500 },
    ],
  );
  assert.equal(alignment.value.matchedWordCount, 5);
  assert.equal(alignment.value.interpolatedWordCount, 0);
  assert.ok(alignment.value.words.every((word) => word.origin === "transcribed"));
  assert.equal(alignment.value.track.alignmentSource, "whisper_fallback");
  assert.equal(alignment.value.track.sentenceId, "s1");
  assert.equal(alignment.value.track.durationMs, 1_500);
  assertTrackParseable(alignment.value.track);
});

test("漏字容忍：转写缺字时该词用邻词插值并在报告中标注", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "到店看过程",
    replacements: [],
    transcribedWords: [
      { word: "到店", startMs: 0, endMs: 600 },
      { word: "过程", startMs: 900, endMs: 1_500 },
    ],
    durationMs: 1_500,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, origin }) => ({ text, origin })),
    [
      { text: "到", origin: "transcribed" },
      { text: "店", origin: "transcribed" },
      { text: "看", origin: "interpolated" },
      { text: "过", origin: "transcribed" },
      { text: "程", origin: "transcribed" },
    ],
  );
  const interpolated = alignment.value.words[2];
  assert.deepEqual(
    interpolated && { startMs: interpolated.startMs, endMs: interpolated.endMs },
    { startMs: 600, endMs: 900 },
    "插值取前词 endMs 到后词 startMs 的区间",
  );
  assert.equal(alignment.value.matchedWordCount, 4);
  assert.equal(alignment.value.interpolatedWordCount, 1);
  assertTrackParseable(alignment.value.track);
});

test("多字容忍：转写多出的语气词被窗口跳过，不破坏后续对齐", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "到店看过程",
    replacements: [],
    transcribedWords: [
      { word: "啊", startMs: 0, endMs: 200 },
      { word: "到店", startMs: 200, endMs: 800 },
      { word: "看", startMs: 800, endMs: 1_100 },
      { word: "过程", startMs: 1_100, endMs: 1_700 },
    ],
    durationMs: 1_700,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [
      { text: "到", startMs: 200, endMs: 500 },
      { text: "店", startMs: 500, endMs: 800 },
      { text: "看", startMs: 800, endMs: 1_100 },
      { text: "过", startMs: 1_100, endMs: 1_400 },
      { text: "程", startMs: 1_400, endMs: 1_700 },
    ],
  );
  assert.ok(alignment.value.words.every((word) => word.origin === "transcribed"));
  assertTrackParseable(alignment.value.track);
});

test("拆字容忍：转写把一个词拆成多条目时按覆盖区间取首尾时间", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "hello",
    replacements: [],
    transcribedWords: [
      { word: "hel", startMs: 0, endMs: 300 },
      { word: "lo", startMs: 300, endMs: 600 },
    ],
    durationMs: 600,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;
  assert.deepEqual(
    alignment.value.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [{ text: "hello", startMs: 0, endMs: 600 }],
  );
  assert.equal(alignment.value.words[0]?.origin, "transcribed");
});

test("英文按空格词切分并对齐，中文部分仍逐字细分", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "Hello world 大家好",
    replacements: [],
    transcribedWords: [
      { word: "hello,", startMs: 0, endMs: 500 },
      { word: "World", startMs: 500, endMs: 1_000 },
      { word: "大家好", startMs: 1_000, endMs: 1_800 },
    ],
    durationMs: 1_800,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [
      { text: "Hello", startMs: 0, endMs: 500 },
      { text: "world", startMs: 500, endMs: 1_000 },
      { text: "大", startMs: 1_000, endMs: 1_000 + 800 / 3 },
      { text: "家", startMs: 1_000 + 800 / 3, endMs: 1_000 + (800 * 2) / 3 },
      { text: "好", startMs: 1_000 + (800 * 2) / 3, endMs: 1_800 },
    ],
  );
  assert.ok(alignment.value.words.every((word) => word.origin === "transcribed"));
  assertTrackParseable(alignment.value.track);
});

test("替换映射参与对齐：原文 & 通过「和」取回转写实测时间", () => {
  const cleaning = cleanNarrationSpeechText("优惠&好礼");
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "优惠&好礼",
    replacements: cleaning.replacements,
    transcribedWords: [
      { word: "优惠", startMs: 0, endMs: 500 },
      { word: "和", startMs: 500, endMs: 700 },
      { word: "好礼", startMs: 700, endMs: 1_200 },
    ],
    durationMs: 1_200,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, startMs, endMs, origin }) => ({ text, startMs, endMs, origin })),
    [
      { text: "优", startMs: 0, endMs: 250, origin: "transcribed" },
      { text: "惠", startMs: 250, endMs: 500, origin: "transcribed" },
      { text: "&", startMs: 500, endMs: 700, origin: "transcribed" },
      { text: "好", startMs: 700, endMs: 950, origin: "transcribed" },
      { text: "礼", startMs: 950, endMs: 1_200, origin: "transcribed" },
    ],
  );
  assertTrackParseable(alignment.value.track);
});

test("乱序容忍：转写词文本倒序时仍可对齐，未匹配词插值并保持结构合法", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "你好",
    replacements: [],
    transcribedWords: [
      { word: "好", startMs: 0, endMs: 500 },
      { word: "你", startMs: 500, endMs: 1_000 },
    ],
    durationMs: 1_000,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;

  assert.deepEqual(
    alignment.value.words.map(({ text, origin }) => ({ text, origin })),
    [
      { text: "你", origin: "transcribed" },
      { text: "好", origin: "interpolated" },
    ],
  );
  assert.equal(alignment.value.matchedWordCount, 1);
  assert.equal(alignment.value.interpolatedWordCount, 1);
  for (const [index, word] of alignment.value.words.entries()) {
    assert.ok(word.endMs > word.startMs, "每个词必须是正区间");
    if (index > 0) {
      assert.ok(word.startMs >= (alignment.value.words[index - 1]?.endMs ?? 0), "词级时间不能重叠或倒序");
    }
  }
  assertTrackParseable(alignment.value.track);
});

test("转写时间倒挂时不抛异常，产物仍满足实测音轨契约", () => {
  const alignment = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "你好",
    replacements: [],
    transcribedWords: [
      { word: "你", startMs: 500, endMs: 1_000 },
      { word: "好", startMs: 0, endMs: 500 },
    ],
    durationMs: 1_000,
  });
  assert.equal(alignment.ok, true);
  if (!alignment.ok) return;
  const words = alignment.value.track.words ?? [];
  assert.equal(words.length, 2);
  assertTrackParseable(alignment.value.track);
});

test("结尾未匹配段插值到本句实测时长，开头段插值从 0 开始", () => {
  const tail = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "欢迎光临",
    replacements: [],
    transcribedWords: [{ word: "欢迎", startMs: 0, endMs: 400 }],
    durationMs: 1_000,
  });
  assert.equal(tail.ok, true);
  if (!tail.ok) return;
  assert.deepEqual(
    tail.value.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [
      { text: "欢", startMs: 0, endMs: 200 },
      { text: "迎", startMs: 200, endMs: 400 },
      { text: "光", startMs: 400, endMs: 700 },
      { text: "临", startMs: 700, endMs: 1_000 },
    ],
  );

  const head = alignNarrationWordsWithWhisper({
    sentenceId: "s1",
    text: "欢迎光临",
    replacements: [],
    transcribedWords: [{ word: "光临", startMs: 400, endMs: 900 }],
    durationMs: 1_000,
  });
  assert.equal(head.ok, true);
  if (!head.ok) return;
  assert.deepEqual(
    head.value.words.map(({ text, origin }) => ({ text, origin })),
    [
      { text: "欢", origin: "interpolated" },
      { text: "迎", origin: "interpolated" },
      { text: "光", origin: "transcribed" },
      { text: "临", origin: "transcribed" },
    ],
  );
  assert.deepEqual(
    head.value.words.map(({ startMs, endMs }) => ({ startMs, endMs })),
    [
      { startMs: 0, endMs: 200 },
      { startMs: 200, endMs: 400 },
      { startMs: 400, endMs: 650 },
      { startMs: 650, endMs: 900 },
    ],
  );
});

test("whisperTranscriptEndMs 取末尾词 endMs 上取整，供调用方显式选择 durationMs", () => {
  assert.equal(
    whisperTranscriptEndMs([
      { word: "到店", startMs: 0, endMs: 320.5 },
      { word: "看", startMs: 320.5, endMs: 900.2 },
    ]),
    901,
  );
  assert.equal(whisperTranscriptEndMs([]), 0);
});

test("对齐函数对非法输入返回稳定错误码，而不是抛异常", () => {
  const base = {
    sentenceId: "s1",
    text: "到店",
    replacements: [],
    transcribedWords: [{ word: "到店", startMs: 0, endMs: 600 }],
    durationMs: 1_000,
  } as const;

  const cases: readonly { readonly patch: Record<string, unknown>; readonly code: string }[] = [
    { patch: { sentenceId: "  " }, code: "NARRATION_TIMING_SENTENCE_ID_INVALID" },
    { patch: { text: "  " }, code: "NARRATION_TIMING_TEXT_INVALID" },
    { patch: { durationMs: 0 }, code: "NARRATION_TIMING_DURATION_INVALID" },
    { patch: { durationMs: -100 }, code: "NARRATION_TIMING_DURATION_INVALID" },
    { patch: { durationMs: Number.POSITIVE_INFINITY }, code: "NARRATION_TIMING_DURATION_INVALID" },
    { patch: { durationMs: "1000" }, code: "NARRATION_TIMING_DURATION_INVALID" },
    { patch: { transcribedWords: [] }, code: "NARRATION_TIMING_TRANSCRIPT_EMPTY" },
    { patch: { transcribedWords: [{ word: "到店", startMs: 0, endMs: 1_200 }] }, code: "NARRATION_TIMING_TRANSCRIPT_INVALID" },
    { patch: { transcribedWords: [{ word: "到店", startMs: 500, endMs: 100 }] }, code: "NARRATION_TIMING_TRANSCRIPT_INVALID" },
    { patch: { transcribedWords: [{ word: "到店", startMs: -10, endMs: 600 }] }, code: "NARRATION_TIMING_TRANSCRIPT_INVALID" },
    { patch: { transcribedWords: [{ word: "到店", startMs: 0, endMs: Number.NaN }] }, code: "NARRATION_TIMING_TRANSCRIPT_INVALID" },
    { patch: { transcribedWords: [{ word: "，", startMs: 0, endMs: 600 }] }, code: "NARRATION_TIMING_TRANSCRIPT_INVALID" },
  ];

  for (const { patch, code } of cases) {
    const alignment = alignNarrationWordsWithWhisper({ ...base, ...patch });
    assert.equal(alignment.ok, false, `输入应被拒绝：${JSON.stringify(patch)}`);
    if (alignment.ok) continue;
    assert.equal(alignment.code, code, `错误码必须稳定，期望 ${code}，实际 ${alignment.code}`);
    assert.ok(alignment.message.length > 0, "拒绝时必须给出可展示的中文说明");
  }
});
