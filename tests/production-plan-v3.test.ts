import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DECORATIONS_PER_PLAN,
  MAX_DECORATIONS_PER_SHOT,
  productionPlanResultSchema,
  productionPlanResultV3JsonSchema,
  productionPlanResultV3Schema,
  productionDecorationSchema,
  validateProductionPlan,
  type ProductionDecoration,
  type ProductionPlanConstraints,
  type ProductionPlanResultV3,
} from "../packages/ai/src/index";

const constraints: ProductionPlanConstraints = {
  analysisTaskId: "task-1",
  mode: "montage",
  targetDurationSeconds: 20,
  textPreset: "classic_top",
  headlineText: "看得见的真实服务",
  subtitleTemplateId: "keyword_pop",
  allowedDecorationIds: ["arrow_right", "star_mark"],
  assets: [
    { id: "asset-image", role: "visual", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
    { id: "asset-detail", role: "visual", kind: "image", mimeType: "image/png", displayName: "细节.png" },
    { id: "asset-video", role: "visual", kind: "video", mimeType: "video/mp4", displayName: "过程.mp4", durationSeconds: 12 },
  ],
};

function plan(): ProductionPlanResultV3 {
  return {
    schemaVersion: "production-plan.v3",
    source: { analysisTaskId: "task-1" },
    title: "看得见的门店服务",
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: { primaryText: "看得见的真实服务", secondaryText: "过程透明，表达克制", preset: "classic_top" },
    subtitle: {
      templateId: "keyword_pop",
      timing: { precision: "estimated", source: "script_estimate" },
      degradedFromTemplateId: null,
    },
    shots: [
      {
        order: 1,
        assetId: "asset-image",
        durationSeconds: 8,
        narration: "第一次到店，不知道服务过程是否适合自己？",
        caption: "先看清服务过程",
        fit: "cover",
        cues: [
          { startMs: 0, endMs: 3800, text: "第一次到店总是没底", emphasisWords: ["没底"], words: null },
          {
            startMs: 3800,
            endMs: 8000,
            text: "先看清过程",
            emphasisWords: ["过程"],
            words: [
              { text: "先", startMs: 3800, endMs: 4400 },
              { text: "看清", startMs: 4400, endMs: 6200 },
              { text: "过程", startMs: 6200, endMs: 8000 },
            ],
          },
        ],
      },
      {
        order: 2,
        assetId: "asset-video",
        durationSeconds: 12,
        narration: "我们把真实步骤逐一呈现，欢迎到店进一步了解。",
        caption: "真实步骤逐一呈现",
        fit: "cover",
        cues: [
          { startMs: 0, endMs: 6000, text: "真实步骤逐一呈现", emphasisWords: ["逐一"], words: null },
          { startMs: 6000, endMs: 12000, text: "欢迎到店了解", emphasisWords: [], words: null },
        ],
      },
    ],
    decorations: [
      { kind: "sticker", assetRef: "arrow_right", text: null, shotOrder: 1, startMs: 600, endMs: 2600, anchor: "middle_right", scale: 1, animation: "pop" },
      { kind: "floating_text", assetRef: null, text: "真实过程", shotOrder: 2, startMs: 400, endMs: 3000, anchor: "top_left", scale: 1, animation: "fade" },
    ],
  };
}

function rejects(mutate: (draft: ProductionPlanResultV3) => void, expected: RegExp): void {
  const draft = plan();
  mutate(draft);
  assert.throws(() => validateProductionPlan(draft, constraints), expected);
}

test("production-plan.v3 承载字幕模板、逐句时间轴与装饰层，且旧版本仍可解析", () => {
  const parsed = productionPlanResultV3Schema.safeParse(plan());
  assert.ok(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues));
  validateProductionPlan(plan(), constraints);

  const union = productionPlanResultSchema.safeParse(plan());
  assert.ok(union.success);
  assert.equal(union.success && union.data.schemaVersion, "production-plan.v3");

  const legacyV2 = { ...plan(), schemaVersion: "production-plan.v2" as const } as Record<string, unknown>;
  delete legacyV2.subtitle;
  delete legacyV2.decorations;
  const v2Parsed = productionPlanResultSchema.safeParse(legacyV2);
  assert.ok(v2Parsed.success, "v2 计划必须仍然可读");

  const legacyV1 = { ...legacyV2, schemaVersion: "production-plan.v1" } as Record<string, unknown>;
  delete legacyV1.textOverlay;
  const v1Parsed = productionPlanResultSchema.safeParse(legacyV1);
  assert.ok(v1Parsed.success, "v1 计划必须仍然可读");

  const jsonSchema = productionPlanResultV3JsonSchema as { properties?: Record<string, unknown> };
  assert.ok(jsonSchema.properties?.subtitle);
  assert.ok(jsonSchema.properties?.decorations);

  assert.equal(productionDecorationSchema.safeParse(plan().decorations[0]).success, true);
  assert.equal(productionDecorationSchema.safeParse({ ...plan().decorations[0], assetRef: "invented_sticker" }).success, false);
});

test("画面识别记录必须自洽，缺这条记录的老计划仍然打得开", () => {
  const described = plan();
  described.grounding = { visual: "asset_insight", describedAssetIds: ["asset-image", "asset-video"] };
  validateProductionPlan(described, constraints);

  rejects((draft) => { draft.grounding = { visual: "asset_insight", describedAssetIds: [] }; }, /必须列出被识别的素材/u);
  rejects((draft) => { draft.grounding = { visual: "blind", describedAssetIds: ["asset-image"] }; }, /不能列出被识别的素材/u);
  rejects((draft) => { draft.grounding = { visual: "asset_insight", describedAssetIds: ["asset-image", "asset-image"] }; }, /不能重复/u);
  rejects((draft) => { draft.grounding = { visual: "asset_insight", describedAssetIds: ["asset-ghost"] }; }, /必须是本项目已导入的素材/u);

  // Plans written before this field existed had no vision at all; refusing them would take away
  // projects the user already made.
  const legacy = plan();
  delete legacy.grounding;
  assert.equal(productionPlanResultV3Schema.safeParse(legacy).success, true);
  validateProductionPlan(legacy, constraints);
});

test("v3 校验拒绝越界、重叠或与音频不一致的字幕时间轴", () => {
  rejects((draft) => { draft.shots[0]!.cues[1]!.startMs = 1000; }, /重叠或倒序/u);
  rejects((draft) => { draft.shots[0]!.cues[1]!.endMs = 12_000; }, /超出所属镜头时长/u);
  rejects((draft) => { draft.shots[0]!.cues[0]!.endMs = 0; }, /正区间/u);
  rejects((draft) => { draft.shots[0]!.cues[0]!.emphasisWords = ["没有这个词"]; }, /强调词必须出现/u);
  rejects((draft) => { draft.shots[0]!.cues[1]!.words![2]!.text = "别的"; }, /拼接后必须与字幕文本一致/u);
  rejects((draft) => { draft.shots[0]!.cues[1]!.words![0]!.startMs = 100; }, /必须落在所属字幕区间内/u);
  rejects((draft) => { draft.shots[0]!.cues[1]!.words![1]!.startMs = 3900; }, /重叠或倒序/u);
  rejects((draft) => { draft.subtitle = { ...draft.subtitle, templateId: "variety_card" }; }, /字幕模板与用户选择不一致/u);
});

test("v3 校验不允许计划宣称高于实际证据的字幕时间精度", () => {
  const karaokeConstraints: ProductionPlanConstraints = { ...constraints, subtitleTemplateId: "karaoke_glow" };

  const honestDegrade = plan();
  honestDegrade.subtitle = {
    templateId: "classic_line",
    timing: { precision: "estimated", source: "script_estimate" },
    degradedFromTemplateId: "karaoke_glow",
  };
  validateProductionPlan(honestDegrade, karaokeConstraints);

  const keptKaraoke = plan();
  keptKaraoke.subtitle = {
    templateId: "karaoke_glow",
    timing: { precision: "estimated", source: "script_estimate" },
    degradedFromTemplateId: null,
  };
  assert.throws(() => validateProductionPlan(keptKaraoke, karaokeConstraints), /降级结果与时间精度不匹配/u);

  rejects(
    (draft) => { draft.subtitle = { ...draft.subtitle, timing: { precision: "word", source: "script_estimate" } }; },
    /精度与时间来源不一致/u,
  );
  rejects(
    (draft) => { draft.subtitle = { ...draft.subtitle, timing: { precision: "word", source: "asr_word" } }; },
    /每条字幕都必须带词级时间/u,
  );
  rejects(
    (draft) => { draft.subtitle = { ...draft.subtitle, degradedFromTemplateId: "karaoke_glow" }; },
    /字幕模板与用户选择不一致/u,
  );
});

test("v3 校验按白名单和密度上限拦住装饰层", () => {
  rejects((draft) => { draft.decorations[0]!.assetRef = "sparkle"; }, /不在内置素材清单/u);
  rejects((draft) => { draft.decorations[0]!.text = "多余文字"; }, /贴纸装饰必须引用素材清单/u);
  rejects((draft) => { draft.decorations[1]!.text = null; }, /浮动文字装饰必须给出文字/u);
  rejects((draft) => { draft.decorations[0]!.shotOrder = 9; }, /不存在的镜头/u);
  rejects((draft) => { draft.decorations[0]!.endMs = 9000; }, /装饰结束时间超出/u);
  rejects((draft) => { draft.decorations[0]!.endMs = draft.decorations[0]!.startMs; }, /正区间/u);

  const overShot = plan();
  overShot.decorations = Array.from({ length: MAX_DECORATIONS_PER_SHOT + 1 }, (): ProductionDecoration => ({
    kind: "sticker", assetRef: "star_mark", text: null, shotOrder: 1, startMs: 100, endMs: 2000, anchor: "top_right", scale: 1, animation: "fade",
  }));
  assert.throws(() => validateProductionPlan(overShot, constraints), /单个镜头的装饰数量超出上限/u);

  const overPlan = plan();
  overPlan.decorations = Array.from({ length: MAX_DECORATIONS_PER_PLAN + 1 }, (): ProductionDecoration => ({
    kind: "sticker", assetRef: "star_mark", text: null, shotOrder: 1, startMs: 100, endMs: 2000, anchor: "top_right", scale: 1, animation: "fade",
  }));
  assert.throws(() => validateProductionPlan(overPlan, constraints), /装饰数量超出单条视频上限/u);

  const noCatalogue = plan();
  assert.throws(
    () => validateProductionPlan(noCatalogue, { ...constraints, allowedDecorationIds: [] }),
    /不在内置素材清单/u,
    "没有内置素材清单时不允许任何贴纸",
  );
});

test("v3 继续沿用既有时长守恒、素材引用与数字人约束", () => {
  rejects((draft) => { draft.shots[0]!.durationSeconds = 9; }, /镜头总时长不一致/u);
  rejects((draft) => { draft.shots[0]!.assetId = "invented"; }, /引用了不存在的素材/u);
  rejects((draft) => { draft.source.analysisTaskId = "other"; }, /来源与真实拆解任务不一致/u);
  rejects((draft) => { draft.textOverlay.primaryText = "换了主文字"; }, /没有逐字使用用户填写的主文字/u);
  rejects((draft) => { draft.audio.backgroundMusicVolume = 0.2; }, /没有背景音乐时音量必须为0/u);

  const avatarConstraints: ProductionPlanConstraints = {
    ...constraints,
    mode: "avatar",
    assets: [{ id: "avatar-video", role: "avatar", kind: "video", mimeType: "video/mp4", displayName: "口播.mp4", durationSeconds: 20 }],
  };
  const avatarPlan = plan();
  for (const shot of avatarPlan.shots) (shot as { assetId: string }).assetId = "avatar-video";
  validateProductionPlan(avatarPlan, avatarConstraints);

  const withMusic = plan();
  for (const shot of withMusic.shots) (shot as { assetId: string }).assetId = "avatar-video";
  withMusic.audio = { ...withMusic.audio, backgroundMusicAssetId: "avatar-video", backgroundMusicVolume: 0.1 };
  assert.throws(() => validateProductionPlan(withMusic, avatarConstraints), /背景音乐必须引用已导入的音频素材/u);
});
