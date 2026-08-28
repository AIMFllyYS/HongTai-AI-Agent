import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTtsTimedTrack,
  timedTrackTimingSource,
  TTS_TIMED_TRACK_CONTRACT_VERSION,
  TTS_TIMING_ALIGNMENT_SOURCES,
  type TtsTimedTrack,
} from "../packages/core/src/index";

test("实测音轨契约版本固定，变更必须显式推进", () => {
  assert.equal(TTS_TIMED_TRACK_CONTRACT_VERSION, "tts-timed-track.v1");
  assert.deepEqual(TTS_TIMING_ALIGNMENT_SOURCES, ["native", "whisper_fallback"]);
});

test("时间戳来路映射到 subtitle-timing 既有精度：有词级时间就是 asr_word", () => {
  const withWords: TtsTimedTrack = {
    sentenceId: "sentence-1",
    durationMs: 5_000,
    alignmentSource: "native",
    words: [{ text: "到店", startMs: 0, endMs: 600 }],
  };
  assert.equal(timedTrackTimingSource(withWords), "asr_word");

  const fallbackWithWords: TtsTimedTrack = {
    sentenceId: "sentence-1",
    durationMs: 5_000,
    alignmentSource: "whisper_fallback",
    words: [{ text: "到店", startMs: 0, endMs: 600 }],
  };
  assert.equal(timedTrackTimingSource(fallbackWithWords), "asr_word", "转写反查的词级时间同样支撑 asr_word");

  const sentenceOnly: TtsTimedTrack = {
    sentenceId: "sentence-1",
    durationMs: 5_000,
    alignmentSource: "native",
  };
  assert.equal(timedTrackTimingSource(sentenceOnly), "tts_duration");

  const nullWords: TtsTimedTrack = { ...sentenceOnly, words: null };
  assert.equal(timedTrackTimingSource(nullWords), "tts_duration");

  const emptyWords: TtsTimedTrack = { ...sentenceOnly, words: [] };
  assert.equal(timedTrackTimingSource(emptyWords), "tts_duration", "空词表不构成词级证据");
});

test("解析接受完整实测音轨，词级时间戳逐条保留", () => {
  const parsed = parseTtsTimedTrack({
    sentenceId: "sentence-1",
    durationMs: 5_000,
    alignmentSource: "whisper_fallback",
    words: [
      { text: "到店", startMs: 0, endMs: 600 },
      { text: "看过程", startMs: 600, endMs: 1_500 },
    ],
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.sentenceId, "sentence-1");
  assert.equal(parsed.value.durationMs, 5_000);
  assert.equal(parsed.value.alignmentSource, "whisper_fallback");
  assert.deepEqual(parsed.value.words, [
    { text: "到店", startMs: 0, endMs: 600 },
    { text: "看过程", startMs: 600, endMs: 1_500 },
  ]);
});

test("解析接受只有句级时长的最小音轨，words 省略与显式 null 等价", () => {
  for (const words of [undefined, null]) {
    const parsed = parseTtsTimedTrack({
      sentenceId: "sentence-1",
      durationMs: 4_800,
      alignmentSource: "native",
      words,
    });
    assert.equal(parsed.ok, true, `words=${String(words)} 应被接受`);
    if (!parsed.ok) continue;
    assert.equal(parsed.value.words, undefined, "无词级证据时省略 words 字段");
  }
});

test("非法输入返回稳定错误码，而不是抛异常", () => {
  const cases: readonly { readonly value: unknown; readonly code: string }[] = [
    { value: null, code: "TTS_TIMED_TRACK_UNREADABLE" },
    { value: "不是对象", code: "TTS_TIMED_TRACK_UNREADABLE" },
    { value: { durationMs: 5_000, alignmentSource: "native" }, code: "TTS_TIMED_TRACK_SENTENCE_ID_INVALID" },
    { value: { sentenceId: "  ", durationMs: 5_000, alignmentSource: "native" }, code: "TTS_TIMED_TRACK_SENTENCE_ID_INVALID" },
    { value: { sentenceId: "s1", alignmentSource: "native" }, code: "TTS_TIMED_TRACK_DURATION_INVALID" },
    { value: { sentenceId: "s1", durationMs: 0, alignmentSource: "native" }, code: "TTS_TIMED_TRACK_DURATION_INVALID" },
    { value: { sentenceId: "s1", durationMs: -100, alignmentSource: "native" }, code: "TTS_TIMED_TRACK_DURATION_INVALID" },
    { value: { sentenceId: "s1", durationMs: Number.POSITIVE_INFINITY, alignmentSource: "native" }, code: "TTS_TIMED_TRACK_DURATION_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000 }, code: "TTS_TIMED_TRACK_ALIGNMENT_SOURCE_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "asr_fallback" }, code: "TTS_TIMED_TRACK_ALIGNMENT_SOURCE_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: "词不是数组" }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: ["词不是对象"] }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: [{ startMs: 0, endMs: 100 }] }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: [{ text: "  ", startMs: 0, endMs: 100 }] }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: [{ text: "到店", startMs: 100, endMs: 100 }] }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
    { value: { sentenceId: "s1", durationMs: 5_000, alignmentSource: "native", words: [{ text: "到店", startMs: "0", endMs: 100 }] }, code: "TTS_TIMED_TRACK_WORDS_INVALID" },
  ];

  for (const { value, code } of cases) {
    const parsed = parseTtsTimedTrack(value);
    assert.equal(parsed.ok, false, `输入应被拒绝：${JSON.stringify(value)}`);
    if (parsed.ok) continue;
    assert.equal(parsed.code, code, `错误码必须稳定，期望 ${code}`);
    assert.ok(parsed.message.length > 0, "拒绝时必须给出可展示的中文说明");
  }
});

test("词级时间不能重叠、倒序或越出本句实测时长", () => {
  const overlapping = parseTtsTimedTrack({
    sentenceId: "s1",
    durationMs: 5_000,
    alignmentSource: "native",
    words: [
      { text: "到店", startMs: 0, endMs: 600 },
      { text: "看", startMs: 500, endMs: 900 },
    ],
  });
  assert.equal(overlapping.ok, false, "重叠词级时间应被拒绝");
  if (!overlapping.ok) assert.equal(overlapping.code, "TTS_TIMED_TRACK_WORDS_INVALID");

  const beyondDuration = parseTtsTimedTrack({
    sentenceId: "s1",
    durationMs: 5_000,
    alignmentSource: "native",
    words: [{ text: "到店", startMs: 4_900, endMs: 5_100 }],
  });
  assert.equal(beyondDuration.ok, false, "超出实测时长的词级时间应被拒绝");
  if (!beyondDuration.ok) assert.equal(beyondDuration.code, "TTS_TIMED_TRACK_WORDS_INVALID");

  const negativeStart = parseTtsTimedTrack({
    sentenceId: "s1",
    durationMs: 5_000,
    alignmentSource: "native",
    words: [{ text: "到店", startMs: -100, endMs: 500 }],
  });
  assert.equal(negativeStart.ok, false, "负起点时间应被拒绝");
  if (!negativeStart.ok) assert.equal(negativeStart.code, "TTS_TIMED_TRACK_WORDS_INVALID");
});

test("词级时间恰好在实测时长边界上时被接受", () => {
  const parsed = parseTtsTimedTrack({
    sentenceId: "s1",
    durationMs: 5_000,
    alignmentSource: "native",
    words: [{ text: "到店", startMs: 0, endMs: 5_000 }],
  });
  assert.equal(parsed.ok, true);
});
