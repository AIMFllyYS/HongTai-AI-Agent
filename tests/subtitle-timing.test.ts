import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShotCueTimeline,
  cueCharacterBudget,
  MAX_CUE_CHARACTERS,
  MIN_CUE_DURATION_MS,
  resolveTemplateForPrecision,
  splitSubtitleLines,
  subtitleTemplateById,
  subtitleTimingPrecision,
  SUBTITLE_TIMING_SOURCES,
} from "../packages/core/src/index";

const classic = subtitleTemplateById("classic_line");

test("逐句时间轴按字符权重铺满镜头，且不重叠、不越界", () => {
  const durationMs = 9_000;
  const cues = buildShotCueTimeline({
    text: "第一次到店总是没底，不知道服务过程是否适合自己。我们把真实步骤逐一呈现，欢迎到店了解。",
    shotDurationMs: durationMs,
    typography: classic.typography,
  });

  assert.ok(cues.length >= 2, "较长旁白必须切成多条字幕");
  assert.equal(cues[0]?.startMs, 0, "第一条字幕必须从镜头起点开始");
  assert.equal(cues.at(-1)?.endMs, durationMs, "最后一条字幕必须正好落在镜头终点");

  let previousEndMs = 0;
  for (const cue of cues) {
    assert.equal(cue.startMs, previousEndMs, "字幕之间不能有空档或重叠");
    assert.ok(cue.endMs > cue.startMs, "字幕必须是正区间");
    assert.ok(cue.endMs <= durationMs, "字幕不能超出镜头时长");
    previousEndMs = cue.endMs;
  }
});

test("字幕文本按模板行预算切分，且逐字点亮所需的词级时间不被伪造", () => {
  const budget = cueCharacterBudget(classic.typography);
  assert.ok(budget <= MAX_CUE_CHARACTERS, "单条字幕不能超过计划 Schema 的字数上限");

  const narration = "我们把服务过程完整拍下来，你可以先看清每一步再决定要不要到店。";
  const cues = buildShotCueTimeline({ text: narration, shotDurationMs: 12_000, typography: classic.typography });

  for (const cue of cues) {
    assert.ok([...cue.text].length <= budget, `字幕「${cue.text}」超出模板预算 ${budget}`);
    assert.ok(splitSubtitleLines(cue.text, classic.typography).length <= classic.typography.maxLines, "字幕不能超出模板行数");
    assert.equal(cue.words, null, "没有音频证据时不能给出词级时间");
  }

  assert.equal(cues.map((cue) => cue.text).join(""), narration, "字幕必须逐字来自旁白，不能改写或丢字");
});

test("镜头时长不够时合并相邻字幕，而不是让字幕一闪而过", () => {
  const text = "先看清过程，再决定到店。";
  const roomy = buildShotCueTimeline({ text, shotDurationMs: 8_000, typography: classic.typography });
  const cramped = buildShotCueTimeline({ text, shotDurationMs: 1_200, typography: classic.typography });

  assert.ok(cramped.length <= roomy.length, "时长更短时字幕条数不应更多");
  for (const cue of cramped) {
    assert.ok(cue.endMs - cue.startMs >= MIN_CUE_DURATION_MS - 1, `字幕「${cue.text}」停留过短`);
  }
});

test("强调词只挂在真正包含它的那条字幕上", () => {
  const cues = buildShotCueTimeline({
    text: "过程是透明的，价格也是透明的，欢迎到店核对。",
    shotDurationMs: 10_000,
    typography: classic.typography,
    emphasisWords: ["透明", "没有出现的词"],
  });

  for (const cue of cues) {
    for (const word of cue.emphasisWords) {
      assert.ok(cue.text.includes(word), `强调词「${word}」必须出现在字幕「${cue.text}」中`);
    }
    assert.ok(!cue.emphasisWords.includes("没有出现的词"), "文本里没有的词不能作为强调词");
  }
  assert.ok(cues.some((cue) => cue.emphasisWords.includes("透明")), "真实出现的强调词必须被保留");
});

test("时间来源决定精度，精度不足的逐字模板降级为逐行", () => {
  assert.equal(subtitleTimingPrecision("asr_word"), "word");
  assert.equal(subtitleTimingPrecision("asr_segment"), "cue");
  assert.equal(subtitleTimingPrecision("tts_duration"), "estimated");
  assert.equal(subtitleTimingPrecision("script_estimate"), "estimated");

  for (const source of SUBTITLE_TIMING_SOURCES) {
    const precision = subtitleTimingPrecision(source);
    const resolved = resolveTemplateForPrecision({ requestedId: "karaoke_glow", precision });
    if (precision === "word") {
      assert.equal(resolved.template.id, "karaoke_glow", "拿到词级时间时应保留逐字模板");
      assert.equal(resolved.degradedFrom, undefined);
    } else {
      assert.equal(resolved.template.id, "classic_line", `${source} 精度不足时必须降级`);
      assert.equal(resolved.degradedFrom, "karaoke_glow", "降级必须留下可读取的来源标识");
    }
  }

  const unaffected = resolveTemplateForPrecision({ requestedId: "keyword_pop", precision: "estimated" });
  assert.equal(unaffected.template.id, "keyword_pop", "不依赖词级时间的模板不该被降级");
  assert.equal(unaffected.degradedFrom, undefined);

  const unknown = resolveTemplateForPrecision({ requestedId: "", precision: "estimated" });
  assert.equal(unknown.template.id, "classic_line", "没有选择模板时回落到默认模板");
});
