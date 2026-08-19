import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShotCueTimeline,
  cueCharacterBudget,
  MAX_CUE_CHARACTERS,
  MAX_EMPHASIS_WORD_CHARACTERS,
  MAX_EMPHASIS_WORDS_PER_CUE,
  MIN_CUE_DURATION_MS,
  MIN_TAIL_CHARACTERS,
  resolveTemplateForPrecision,
  splitSubtitleLines,
  subtitleTemplateById,
  subtitleTimingPrecision,
  SUBTITLE_TIMING_CONTRACT_VERSION,
  SUBTITLE_TIMING_SOURCES,
} from "../packages/core/src/index";

const classic = subtitleTemplateById("classic_line");

test("字幕时间契约版本固定，变更必须显式推进", () => {
  assert.equal(SUBTITLE_TIMING_CONTRACT_VERSION, "subtitle-timing.v1");
});

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

test("句尾不会留下几个字的碎片字幕", () => {
  // 这条旁白按贪心切分会在末尾剩下两个字，形成一闪而过的碎片。
  const text = "第一次到店没底。服务过程好不好。要花多少时间呢。我们逐一拍下来。你先看清每一步。再决定要不要来。";
  const cues = buildShotCueTimeline({ text, shotDurationMs: 18_000, typography: classic.typography });

  assert.ok(cues.length >= 2, "这条旁白应切成多条，否则覆盖不到收尾处理");
  assert.ok(
    [...(cues.at(-1)?.text ?? "")].length >= MIN_TAIL_CHARACTERS,
    `末尾字幕「${cues.at(-1)?.text}」太短，会被当成渲染故障`,
  );
  assert.equal(cues.map((cue) => cue.text).join(""), text, "收尾重排不能改写或丢字");
  for (const cue of cues) {
    assert.ok(
      splitSubtitleLines(cue.text, classic.typography).length <= classic.typography.maxLines,
      `重排后的字幕「${cue.text}」超出模板行数`,
    );
    assert.ok([...cue.text].length <= MAX_CUE_CHARACTERS, "重排后的字幕不能超过计划 Schema 的字数上限");
  }
});

test("镜头时长不足时如实给出偏短的字幕，而不是丢字或撑破字幕框", () => {
  const text = "第一次到店总是没底，不知道服务过程是否适合自己，也不清楚要花多少时间。我们把真实步骤逐一拍下来。";
  const shotDurationMs = 1_000;
  const roomy = buildShotCueTimeline({ text, shotDurationMs: 18_000, typography: classic.typography });
  const cramped = buildShotCueTimeline({ text, shotDurationMs, typography: classic.typography });

  assert.ok(roomy.length >= 2, "这条旁白应切成多条");
  // 字幕条数由文案和模板行盒决定，压缩时长不能压缩文案。
  assert.equal(cramped.length, roomy.length, "时长变化不该改变字幕条数");
  assert.deepEqual(
    cramped.map((cue) => cue.text),
    roomy.map((cue) => cue.text),
    "时长不足不能靠删字来凑时间",
  );
  assert.ok(
    cramped.some((cue) => cue.endMs - cue.startMs < MIN_CUE_DURATION_MS),
    "放不下时应如实留下偏短的字幕，供导出界面提示用户加长镜头",
  );
  assert.equal(cramped.at(-1)?.endMs, shotDurationMs, "偏短的字幕仍必须铺满镜头");
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

test("强调词数量与长度被裁剪到计划 Schema 允许的范围，而不是让整个计划失败", () => {
  const cues = buildShotCueTimeline({
    text: "透明价格透明流程透明记录透明反馈都可以到店当面核对。",
    shotDurationMs: 10_000,
    typography: classic.typography,
    emphasisWords: ["透明", "价格", "流程", "记录", "反馈", "到店当面核对全部细节"],
  });

  for (const cue of cues) {
    assert.ok(cue.emphasisWords.length <= MAX_EMPHASIS_WORDS_PER_CUE, `字幕「${cue.text}」的强调词超出 Schema 上限`);
    assert.equal(new Set(cue.emphasisWords).size, cue.emphasisWords.length, "强调词不能重复");
    for (const word of cue.emphasisWords) {
      assert.ok([...word].length <= MAX_EMPHASIS_WORD_CHARACTERS, `强调词「${word}」超出 Schema 长度上限`);
    }
  }
  assert.ok(
    cues.every((cue) => !cue.emphasisWords.includes("到店当面核对全部细节")),
    "过长的强调词应被丢弃，而不是写进计划后被 Schema 拒绝",
  );
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
