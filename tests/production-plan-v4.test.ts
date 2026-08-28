import assert from "node:assert/strict";
import test from "node:test";

import { TaskError, type TtsTimedTrack } from "../packages/core/src/index";
import {
  MAX_DECORATIONS_PER_PLAN,
  MAX_DECORATIONS_PER_SHOT,
  MAX_MEASURED_SHOT_MS,
  productionPlanResultSchema,
  productionPlanResultV4Schema,
  validateMeasuredProductionPlan,
  withMeasuredSubtitleTimeline,
  type MeasuredProductionPlanConstraints,
  type MeasuredShotDraft,
  type ProductionPlanGrounding,
  type ProductionPlanResultV4,
} from "../packages/ai/src/index";

const constraints: MeasuredProductionPlanConstraints = {
  analysisTaskId: "task-1",
  mode: "montage",
  textPreset: "classic_top",
  headlineText: "看得见的真实服务",
  subtitleTemplateId: "keyword_pop",
  allowedDecorationIds: ["arrow_right", "star_mark"],
  assets: [
    { id: "asset-image", role: "visual", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
    { id: "asset-detail", role: "visual", kind: "image", mimeType: "image/png", displayName: "细节.png" },
    { id: "asset-music", role: "music", kind: "audio", mimeType: "audio/mpeg", displayName: "轻音乐.mp3" },
  ],
};

function shots(): MeasuredShotDraft[] {
  return [
    {
      sentenceId: "sentence-1",
      assetId: "asset-image",
      narration: "第一次到店总是没底，不知道推拿的服务过程是什么样的，先把真实步骤拍给你看。",
      caption: "先看清服务过程",
      fit: "cover",
    },
    {
      sentenceId: "sentence-2",
      assetId: "asset-detail",
      narration: "我们把每一步真实步骤完整呈现，你看完再决定要不要来，欢迎到店当面了解。",
      caption: "真实步骤逐一呈现",
      fit: "cover",
    },
  ];
}

function track(
  sentenceId: string,
  durationMs: number,
  words?: readonly { readonly text: string; readonly startMs: number; readonly endMs: number }[],
): TtsTimedTrack {
  return { sentenceId, durationMs, alignmentSource: "native", ...(words ? { words } : {}) };
}

function tracks(): TtsTimedTrack[] {
  return [track("sentence-1", 8_000), track("sentence-2", 8_000)];
}

const firstSentenceWords = [
  { text: "第一次到店总是没底，", startMs: 100, endMs: 1_500 },
  { text: "不知道过程什么样，", startMs: 1_560, endMs: 3_400 },
  { text: "先把真实步骤拍给你看。", startMs: 3_500, endMs: 7_800 },
];

function wordedTracks(): TtsTimedTrack[] {
  return [
    track("sentence-1", 8_000, firstSentenceWords),
    track("sentence-2", 8_000, [
      { text: "看完每一步再决定，", startMs: 120, endMs: 2_000 },
      { text: "欢迎到店当面了解。", startMs: 2_080, endMs: 4_600 },
    ]),
  ];
}

function mixedTracks(): TtsTimedTrack[] {
  return [track("sentence-1", 8_000, firstSentenceWords), track("sentence-2", 8_000)];
}

const invalid = (cause: unknown): TaskError =>
  new TaskError({
    code: "AI_STRUCTURED_OUTPUT_INVALID",
    message: typeof cause === "string" ? cause : "实测时长存在无法渲染的硬违规",
    action: "retry",
    cause,
  });

function assemble(overrides: {
  shots?: readonly MeasuredShotDraft[];
  tracks?: readonly TtsTimedTrack[];
  requestedTemplateId?: string;
  grounding?: ProductionPlanGrounding;
  analysisTaskId?: string | null;
} = {}): ProductionPlanResultV4 {
  return withMeasuredSubtitleTimeline({
    source: { analysisTaskId: overrides.analysisTaskId === undefined ? "task-1" : overrides.analysisTaskId },
    title: "看得见的门店服务",
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: { primaryText: "看得见的真实服务", secondaryText: "过程透明，表达克制", preset: "classic_top" },
    shots: overrides.shots ?? shots(),
    tracks: overrides.tracks ?? tracks(),
    requestedTemplateId: overrides.requestedTemplateId ?? "keyword_pop",
    grounding: overrides.grounding ?? { visual: "blind", describedAssetIds: [] },
    decorations: [
      { kind: "sticker", assetRef: "arrow_right", text: null, shotOrder: 1, anchor: "middle_right", scale: 1, animation: "pop" },
      { kind: "floating_text", assetRef: null, text: "真实过程", shotOrder: 2, anchor: "top_left", scale: 1, animation: "fade" },
    ],
    invalid,
  });
}

function rejects(mutate: (draft: ProductionPlanResultV4) => void, expected: RegExp): void {
  const draft = assemble();
  mutate(draft);
  assert.throws(() => validateMeasuredProductionPlan(draft, constraints), expected);
}

test("production-plan.v4 承载实测时长与句子定位，结构上排除目标时长与估算来源", () => {
  const result = assemble();

  assert.equal(productionPlanResultV4Schema.safeParse(result).success, true);
  const union = productionPlanResultSchema.safeParse(result);
  assert.ok(union.success, JSON.stringify(union.success ? {} : union.error.issues));
  assert.equal(union.success && union.data.schemaVersion, "production-plan.v4");

  assert.equal("durationSeconds" in result.settings, false, "v4 没有目标时长，总时长由界面按 ΣdurationMs 求和展示");
  assert.equal(result.shots.every((shot) => Number.isInteger(shot.durationMs)), true);
  assert.deepEqual(result.shots.map((shot) => shot.sentenceId), ["sentence-1", "sentence-2"]);

  // 拆解是可选增强：null 如实表示本次没有参考拆解。
  assert.equal(productionPlanResultV4Schema.safeParse({ ...result, source: { analysisTaskId: null } }).success, true);

  const withoutDuration = JSON.parse(JSON.stringify(result)) as ProductionPlanResultV4;
  for (const shot of withoutDuration.shots) delete (shot as { durationMs?: number }).durationMs;
  assert.equal(productionPlanResultV4Schema.safeParse(withoutDuration).success, false, "实测镜头必须携带 durationMs");

  // 时间来源只能是实测，估算来源结构上排除。
  const estimated = productionPlanResultV4Schema.safeParse({
    ...result,
    subtitle: { ...result.subtitle, timing: { precision: "estimated", source: "script_estimate" } },
  });
  assert.equal(estimated.success, false);

  // 单镜实测时长超过总时长软上限（60 秒）时连确认路径都不支持，应回改文稿。
  const overLimit = productionPlanResultV4Schema.safeParse({
    ...result,
    shots: result.shots.map((shot) => ({ ...shot, durationMs: MAX_MEASURED_SHOT_MS + 1 })),
  });
  assert.equal(overLimit.success, false);
});

test("withMeasuredSubtitleTimeline 用实测音轨组装 v4，时长取整到毫秒时钟", () => {
  const result = assemble({ tracks: [track("sentence-1", 7_600.4), track("sentence-2", 8_000)] });

  assert.equal(result.schemaVersion, "production-plan.v4");
  assert.equal(result.shots[0]?.durationMs, 7_600, "渲染器按整毫秒工作，实测时长先取整再进入计划");
  assert.equal(result.shots[1]?.durationMs, 8_000);
  assert.deepEqual(result.shots.map((shot) => shot.order), [1, 2]);
  assert.deepEqual(result.shots.map((shot) => shot.assetId), ["asset-image", "asset-detail"]);

  for (const shot of result.shots) {
    assert.equal(shot.cues[0]?.startMs, 0, "比例路径第一条字幕从镜头起点开始");
    assert.equal(shot.cues.at(-1)?.endMs, shot.durationMs, "比例路径必须铺满实测时长");
    assert.equal(shot.cues.every((cue) => cue.words === null), true, "没有词级证据时不能给出词级时间");
  }

  assert.deepEqual(validateMeasuredProductionPlan(result, constraints), []);
});

test("字幕完整性：每句口播在 v4 计划里都有逐字覆盖的字幕", () => {
  // 口播含空格与前后空白：切分允许在空白处断句并丢掉边界空白，但非空白字符一个都不能丢。
  const spacedShots: MeasuredShotDraft[] = [
    {
      sentenceId: "sentence-1",
      assetId: "asset-image",
      narration: "  第一次到店总是没底 不知道推拿的服务过程是什么样的 先把真实步骤拍给你看  ",
      caption: "先看清服务过程",
      fit: "cover",
      emphasisWords: ["真实步骤"],
    },
    {
      sentenceId: "sentence-2",
      assetId: "asset-detail",
      narration: "我们把每一步真实步骤完整呈现，你看完再决定要不要来，欢迎到店当面了解。",
      caption: "真实步骤逐一呈现",
      fit: "cover",
    },
  ];

  const result = assemble({
    shots: spacedShots,
    tracks: [track("sentence-1", 9_500), track("sentence-2", 8_000)],
  });

  for (const shot of result.shots) {
    const cues = shot.cues;
    assert.ok(cues.length >= 1, `句子 ${shot.sentenceId} 的口播必须产出字幕`);
    assert.equal(
      cues.map((cue) => cue.text).join("").replace(/\s+/gu, ""),
      shot.narration.replace(/\s+/gu, ""),
      `句子 ${shot.sentenceId} 的字幕拼接必须逐字覆盖整句口播`,
    );
  }
  // 分镜脚本的强调词建议进入对应句的字幕 cue（只挂在包含它的那条上）。
  const emphasisCues = result.shots[0]!.cues.filter((cue) => cue.emphasisWords.length > 0);
  assert.ok(
    emphasisCues.length >= 1 && emphasisCues.every((cue) => cue.text.includes("真实步骤")),
    "强调词必须挂在真正包含它的字幕上",
  );

  assert.deepEqual(validateMeasuredProductionPlan(result, constraints), []);
});

test("数字人源窗口原样烘焙进 v4 计划，与实测时长守恒", () => {
  const avatarShots: MeasuredShotDraft[] = [
    {
      sentenceId: "sentence-1",
      assetId: "asset-image",
      narration: "第一次到店总是没底，不知道推拿的服务过程是什么样的，先把真实步骤拍给你看。",
      caption: "先看清服务过程",
      fit: "cover",
      // 10 秒源视频：第一镜 8 秒 → [0,6]+[0,2]（跨尾回绕拆两窗）。
      sourceWindows: [{ startMs: 0, endMs: 6_000 }, { startMs: 0, endMs: 2_000 }],
    },
    {
      sentenceId: "sentence-2",
      assetId: "asset-detail",
      narration: "我们把每一步真实步骤完整呈现，你看完再决定要不要来，欢迎到店当面了解。",
      caption: "真实步骤逐一呈现",
      fit: "cover",
    },
  ];

  const result = assemble({ shots: avatarShots, tracks: [track("sentence-1", 8_000), track("sentence-2", 8_000)] });
  assert.deepEqual(result.shots[0]?.sourceWindows, [{ startMs: 0, endMs: 6_000 }, { startMs: 0, endMs: 2_000 }]);
  assert.equal(result.shots[1]?.sourceWindows, undefined, "没有窗口的镜头不携带该字段（旧路径语义）");
  assert.equal(productionPlanResultV4Schema.safeParse(result).success, true);

  // 窗口之和 ≠ 实测时长：组装期就拒绝，不等端侧导出才失败。
  const broken: MeasuredShotDraft[] = [{ ...avatarShots[0]!, sourceWindows: [{ startMs: 0, endMs: 6_000 }] }];
  assert.throws(
    () => assemble({ shots: broken, tracks: [track("sentence-1", 8_000)] }),
    /数字人窗口时长之和与实测时长不一致/u,
  );

  // schema 边界：非整毫秒、endMs 不大于 startMs、空数组、超过 30 个窗口都拒绝。
  const json = JSON.parse(JSON.stringify(result)) as ProductionPlanResultV4;
  const mutateWindows = (windows: unknown): unknown =>
    productionPlanResultV4Schema.safeParse({ ...json, shots: [{ ...json.shots[0]!, sourceWindows: windows }, json.shots[1]!] });
  assert.equal(mutateWindows([{ startMs: 0.5, endMs: 6_000 }]).success, false, "窗口必须整毫秒");
  assert.equal(mutateWindows([{ startMs: 6_000, endMs: 6_000 }]).success, false, "endMs 必须大于 startMs");
  assert.equal(mutateWindows([{ startMs: 6_000, endMs: 5_000 }]).success, false, "倒序窗口拒绝");
  assert.equal(mutateWindows([]).success, false, "空窗口数组拒绝：要么缺省，要么至少一窗");
  assert.equal(mutateWindows([{ startMs: 0, endMs: -1 }]).success, false, "负毫秒拒绝");
  assert.equal(
    mutateWindows(Array.from({ length: 31 }, () => ({ startMs: 0, endMs: 1 }))).success,
    false,
    "单镜窗口数沿用共享上限 30",
  );
});

test("词级时间戳直接定界 cue，词前词后静音如实留空", () => {
  const result = assemble({ tracks: wordedTracks(), requestedTemplateId: "karaoke_glow" });

  assert.equal(result.subtitle.timing.source, "asr_word");
  assert.equal(result.subtitle.timing.precision, "word");
  assert.equal(result.subtitle.templateId, "karaoke_glow", "全部音轨都有词级证据时保留逐字模板");
  assert.equal(result.subtitle.degradedFromTemplateId, null);

  const cues = result.shots[0]!.cues;
  assert.ok(cues.length >= 2, "超出模板行盒的词必须分成多条字幕");
  assert.equal(cues[0]?.startMs, 100, "首条字幕从首个词的真实起点开始，词前静音如实留空");
  assert.equal(cues.at(-1)?.endMs, 7_800, "末条字幕在末个词的真实终点结束，词后静音如实留空");
  assert.equal(
    cues.map((cue) => cue.text).join(""),
    firstSentenceWords.map((word) => word.text).join(""),
    "词级路径的字幕文本必须逐字来自词级时间戳的词文本",
  );
  assert.deepEqual(cues.flatMap((cue) => [...(cue.words ?? [])]), firstSentenceWords);

  assert.deepEqual(
    validateMeasuredProductionPlan(result, { ...constraints, subtitleTemplateId: "karaoke_glow" }),
    [],
  );
});

test("任一句缺词级时间戳，整份计划如实声明 tts_duration 并降级模板", () => {
  const result = assemble({ tracks: mixedTracks(), requestedTemplateId: "karaoke_glow" });

  assert.equal(result.subtitle.timing.source, "tts_duration");
  assert.equal(result.subtitle.timing.precision, "estimated");
  assert.equal(result.subtitle.templateId, "classic_line");
  assert.equal(result.subtitle.degradedFromTemplateId, "karaoke_glow");
  assert.equal(result.shots[1]!.cues.every((cue) => cue.words === null), true, "缺词级的句子按实测句长比例铺排");
  assert.equal(result.shots[1]!.cues.at(-1)!.endMs, 8_000);
  assert.ok(result.shots[0]!.cues[0]!.words !== null, "有词级的句子仍用真实词边界定界");

  assert.deepEqual(
    validateMeasuredProductionPlan(result, { ...constraints, subtitleTemplateId: "karaoke_glow" }),
    [],
    "如实降级后的计划可以通过校验",
  );
});

test("分镜句与实测音轨必须一一对应，缺、多、重都不猜", () => {
  assert.throws(() => assemble({ tracks: [track("sentence-1", 8_000)] }), /第 2 句还没有实测音轨/u);
  assert.throws(
    () => assemble({ tracks: [track("sentence-1", 8_000), track("sentence-2", 8_000), track("sentence-3", 8_000)] }),
    /实测音轨 sentence-3 没有对应的分镜句/u,
  );
  assert.throws(
    () => assemble({ shots: [...shots(), { ...shots()[0]! }] }),
    /句子 sentence-1 在分镜里出现了不止一次/u,
  );
  assert.throws(
    () => assemble({ tracks: [track("sentence-1", 8_000), track("sentence-1", 8_000)] }),
    /句子 sentence-1 有不止一条实测音轨/u,
  );
});

test("非法实测时长在组装处就被拒绝；单镜过短降为软提示不再阻断", () => {
  // 250ms 单镜：渲染层可执行，只是可读性偏好，组装放行、软违规如实返回。
  const shortShot = assemble({ tracks: [track("sentence-1", 250), track("sentence-2", 8_000)] });
  assert.deepEqual(validateMeasuredProductionPlan(shortShot, constraints), [
    { reason: "shot-too-short", kind: "soft", shotIndex: 1, durationMs: 250 },
    { reason: "total-too-short", kind: "soft", totalDurationMs: 8_250 },
  ]);
  assert.throws(
    () => assemble({ tracks: [track("sentence-1", 0), track("sentence-2", 8_000)] }),
    /实测时长存在无法渲染的硬违规/u,
  );
});

test("软违规不阻塞组装与校验，结构化返回给界面提示", () => {
  // 总时长不足 15 秒：单镜都在界内，只有总量提示。
  const shortTotal = assemble({ tracks: [track("sentence-1", 5_000), track("sentence-2", 5_000)] });
  assert.deepEqual(validateMeasuredProductionPlan(shortTotal, constraints), [
    { reason: "total-too-short", kind: "soft", totalDurationMs: 10_000 },
  ]);

  // 单镜超过 20 秒：仍可渲染，提示用户回改文稿或确认后继续。
  const longShot = assemble({ tracks: [track("sentence-1", 21_000), track("sentence-2", 8_000)] });
  assert.deepEqual(validateMeasuredProductionPlan(longShot, constraints), [
    { reason: "shot-too-long", kind: "soft", shotIndex: 1, durationMs: 21_000 },
  ]);

  // 总时长超过 60 秒：单镜都不超 20 秒，只有总量提示。
  const fourShots: MeasuredShotDraft[] = Array.from({ length: 4 }, (_, index) => ({
    sentenceId: `sentence-${index + 1}`,
    assetId: "asset-image",
    narration: "这一步我们拍给你看。",
    caption: "真实步骤",
    fit: "cover" as const,
  }));
  const tooLong = assemble({
    shots: fourShots,
    tracks: fourShots.map((shot) => track(shot.sentenceId, 16_000)),
  });
  assert.deepEqual(validateMeasuredProductionPlan(tooLong, constraints), [
    { reason: "total-too-long", kind: "soft", totalDurationMs: 64_000 },
  ]);
});

test("v4 校验拒绝来源不符、顺序断裂、句子 id 重复与硬违规时长", () => {
  rejects((draft) => { draft.source = { analysisTaskId: "task-2" }; }, /来源与真实拆解任务不一致/u);
  rejects((draft) => { draft.shots[0]!.order = 3; }, /顺序不连续/u);
  rejects((draft) => { draft.shots[1]!.sentenceId = draft.shots[0]!.sentenceId; }, /句子 id 不能重复/u);
  rejects((draft) => { draft.shots[0]!.durationMs = 0; }, /实测时长存在无法渲染的硬违规/u);
});

test("v4 校验沿用素材、音频与文字层的既有规则", () => {
  rejects((draft) => { draft.shots[0]!.assetId = "invented"; }, /引用了不存在的素材/u);
  rejects((draft) => { draft.shots[0]!.assetId = "asset-music"; }, /镜头画面不能引用音频素材/u);
  rejects(
    (draft) => { draft.audio = { ...draft.audio, backgroundMusicAssetId: "asset-image", backgroundMusicVolume: 0.2 }; },
    /背景音乐必须引用已导入的音频素材/u,
  );
  rejects((draft) => { draft.audio = { ...draft.audio, backgroundMusicVolume: 0.2 }; }, /没有背景音乐时音量必须为0/u);
  rejects((draft) => { draft.textOverlay = { ...draft.textOverlay, preset: "clean_card" }; }, /文字预设与用户选择不一致/u);
  rejects((draft) => { draft.textOverlay = { ...draft.textOverlay, primaryText: "换了主文字" }; }, /没有逐字使用用户填写的主文字/u);
});

test("v4 校验拒绝越界或宣称高于实际证据的字幕时间轴", () => {
  rejects((draft) => { draft.shots[0]!.cues[1]!.startMs = 1_000; }, /重叠或倒序/u);
  rejects((draft) => { draft.shots[0]!.cues[1]!.endMs = 20_000; }, /超出所属镜头时长/u);
  rejects((draft) => { draft.shots[0]!.cues[0]!.emphasisWords = ["没有这个词"]; }, /强调词必须出现/u);
  rejects(
    (draft) => { draft.subtitle = { ...draft.subtitle, timing: { precision: "word", source: "asr_word" } }; },
    /每条字幕都必须带词级时间/u,
  );
});

test("v4 装饰层沿用白名单与密度上限", () => {
  rejects((draft) => { draft.decorations[0]!.assetRef = "sparkle"; }, /不在内置素材清单/u);
  rejects((draft) => { draft.decorations[0]!.text = "多余文字"; }, /贴纸装饰必须引用素材清单/u);
  rejects((draft) => { draft.decorations[1]!.text = null; }, /浮动文字装饰必须给出文字/u);
  rejects((draft) => { draft.decorations[0]!.shotOrder = 3; }, /不存在的镜头/u);
  rejects((draft) => { draft.decorations[0]!.endMs = 20_000; }, /装饰结束时间超出/u);
  assert.equal(MAX_DECORATIONS_PER_SHOT, 2);

  const overShot = assemble();
  overShot.decorations = [
    ...overShot.decorations,
    { ...overShot.decorations[0]!, anchor: "top_right" },
    { ...overShot.decorations[0]!, anchor: "bottom_left" },
  ];
  assert.throws(() => validateMeasuredProductionPlan(overShot, constraints), /单个镜头的装饰数量超出上限/u);

  const overPlan = assemble();
  overPlan.decorations = Array.from({ length: MAX_DECORATIONS_PER_PLAN + 1 }, () => ({ ...overPlan.decorations[0]! }));
  assert.throws(() => validateMeasuredProductionPlan(overPlan, constraints), /装饰数量超出单条视频上限/u);
});

test("v4 画面识别记录必须自洽", () => {
  rejects((draft) => { draft.grounding = { visual: "asset_insight", describedAssetIds: [] }; }, /必须列出被识别的素材/u);
  rejects((draft) => { draft.grounding = { visual: "blind", describedAssetIds: ["asset-image"] }; }, /不能列出被识别的素材/u);
  rejects((draft) => { draft.grounding = { visual: "asset_insight", describedAssetIds: ["asset-ghost"] }; }, /必须是本项目已导入的素材/u);

  const described = assemble({ grounding: { visual: "asset_insight", describedAssetIds: ["asset-image"] } });
  assert.deepEqual(validateMeasuredProductionPlan(described, constraints), []);
});

test("口播切片模式只能使用口播视频且不叠背景音乐", () => {
  const avatarConstraints: MeasuredProductionPlanConstraints = {
    ...constraints,
    mode: "avatar",
    assets: [
      { id: "avatar-video", role: "avatar", kind: "video", mimeType: "video/mp4", displayName: "口播.mp4", durationSeconds: 20 },
      { id: "asset-image", role: "visual", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
      { id: "asset-music", role: "music", kind: "audio", mimeType: "audio/mpeg", displayName: "轻音乐.mp3" },
    ],
  };

  const avatarPlan = assemble({ grounding: { visual: "not_applicable", describedAssetIds: [] } });
  for (const shot of avatarPlan.shots) shot.assetId = "avatar-video";
  assert.deepEqual(validateMeasuredProductionPlan(avatarPlan, avatarConstraints), []);

  const stray = assemble({ grounding: { visual: "not_applicable", describedAssetIds: [] } });
  stray.shots[0]!.assetId = "avatar-video";
  stray.shots[1]!.assetId = "asset-image";
  assert.throws(() => validateMeasuredProductionPlan(stray, avatarConstraints), /口播切片计划只能使用上传的口播切片视频/u);

  const withMusic = assemble({ grounding: { visual: "not_applicable", describedAssetIds: [] } });
  for (const shot of withMusic.shots) shot.assetId = "avatar-video";
  withMusic.audio = { ...withMusic.audio, backgroundMusicAssetId: "asset-music", backgroundMusicVolume: 0.1 };
  assert.throws(() => validateMeasuredProductionPlan(withMusic, avatarConstraints), /口播切片模式保留原视频声音/u);
});

test("没有参考拆解时如实以 null 持久化来源", () => {
  const plan = assemble({ analysisTaskId: null });

  assert.equal(plan.source.analysisTaskId, null);
  assert.deepEqual(validateMeasuredProductionPlan(plan, { ...constraints, analysisTaskId: null }), []);
  assert.throws(
    () => validateMeasuredProductionPlan(plan, constraints),
    /来源与真实拆解任务不一致/u,
    "null 与具体任务 id 不得混用",
  );
});
