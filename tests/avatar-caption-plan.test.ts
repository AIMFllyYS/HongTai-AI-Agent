import assert from "node:assert/strict";
import test from "node:test";

import { createAvatarCaptionPlan, productionPlanResultV3Schema, validateProductionPlan } from "../packages/ai/src/index";

const AVATAR_ASSET = { id: "avatar-1", role: "avatar", kind: "video", mimeType: "video/mp4", displayName: "口播.mp4", durationSeconds: 18 } as const;

test("数字人口播计划只使用原视频，并从用户口播稿生成连续短字幕", () => {
  const script = "欢迎来到我们的门店。今天带你看看真实服务过程。每一步都清晰展示，方便你安心了解。";
  const plan = createAvatarCaptionPlan({
    analysisTaskId: "task-1",
    brief: "自然介绍门店服务",
    targetDurationSeconds: 15,
    avatarScript: script,
    headlineText: "门店真实介绍",
    textPreset: "classic_top" as const,
    avatarAsset: { id: "avatar-1", durationSeconds: 18 },
  });

  assert.equal(plan.shots.length, 3);
  assert.equal(plan.shots.every((shot) => shot.assetId === "avatar-1"), true);
  assert.equal(plan.shots.reduce((total, shot) => total + shot.durationSeconds, 0), 15);
  assert.equal(plan.shots.map((shot) => shot.caption).join(""), script);
  assert.equal(plan.shots.map((shot) => shot.narration).join(""), script);
  assert.equal(plan.audio.backgroundMusicAssetId, null);
  assert.equal(plan.audio.backgroundMusicVolume, 0);
});

test("数字人口播计划产出可执行的 v3 逐句时间轴，并说明时间只是按字数推算", () => {
  const script = "欢迎来到我们的门店。今天带你看看真实服务过程。每一步都清晰展示，方便你安心了解。";
  const plan = createAvatarCaptionPlan({
    analysisTaskId: "task-1",
    brief: "自然介绍门店服务",
    targetDurationSeconds: 15,
    avatarScript: script,
    headlineText: "门店真实介绍",
    textPreset: "classic_top",
    subtitleTemplateId: "keyword_pop",
    avatarAsset: AVATAR_ASSET,
  });

  const parsed = productionPlanResultV3Schema.safeParse(plan);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues));
  validateProductionPlan(plan, {
    analysisTaskId: "task-1",
    mode: "avatar",
    targetDurationSeconds: 15,
    textPreset: "classic_top",
    headlineText: "门店真实介绍",
    subtitleTemplateId: "keyword_pop",
    assets: [AVATAR_ASSET],
  });

  assert.equal(plan.subtitle.templateId, "keyword_pop");
  assert.deepEqual(plan.subtitle.timing, { precision: "estimated", source: "script_estimate" });
  assert.equal(plan.subtitle.degradedFromTemplateId, null);
  // The words are the user's own script over their own recording, so there is no material to match
  // and the plan must not be labelled as blindly matched.
  assert.deepEqual(plan.grounding, { visual: "not_applicable", describedAssetIds: [] });

  for (const shot of plan.shots) {
    const shotEndMs = Math.round(shot.durationSeconds * 1_000);
    assert.ok(shot.cues.length >= 1, "每个镜头都必须有字幕");
    assert.equal(shot.cues[0]?.startMs, 0);
    assert.equal(shot.cues.at(-1)?.endMs, shotEndMs, "字幕必须铺满镜头且不越界");
    assert.equal(shot.cues.every((cue) => cue.words === null), true, "没有真实语音时间时不能给出词级时间");
  }
  assert.equal(plan.shots.flatMap((shot) => shot.cues).map((cue) => cue.text).join(""), script, "字幕必须逐字来自口播稿");
});

test("数字人口播没有词级时间，逐字点亮模板降级为逐行并留下降级来源", () => {
  const plan = createAvatarCaptionPlan({
    analysisTaskId: "task-1",
    brief: "自然介绍门店服务",
    targetDurationSeconds: 15,
    avatarScript: "欢迎来到我们的门店。今天带你看看真实服务过程。每一步都清晰展示，方便你安心了解。",
    headlineText: "门店真实介绍",
    textPreset: "classic_top",
    subtitleTemplateId: "karaoke_glow",
    avatarAsset: AVATAR_ASSET,
  });

  assert.equal(plan.subtitle.templateId, "classic_line", "拿不到词级时间时不能伪造逐字点亮");
  assert.equal(plan.subtitle.degradedFromTemplateId, "karaoke_glow", "降级来源必须可被界面读取");
  validateProductionPlan(plan, {
    analysisTaskId: "task-1",
    mode: "avatar",
    targetDurationSeconds: 15,
    textPreset: "classic_top",
    headlineText: "门店真实介绍",
    subtitleTemplateId: "karaoke_glow",
    assets: [AVATAR_ASSET],
  });
});

test("数字人口播不会把短视频拉长重播，也不会接受无法阅读的短口播稿", () => {
  const input = {
    analysisTaskId: "task-1",
    brief: "自然介绍门店服务",
    targetDurationSeconds: 30,
    avatarScript: "欢迎来到我们的门店。这里展示真实服务过程，欢迎你安心了解。",
    headlineText: "门店真实介绍",
    textPreset: "classic_top" as const,
  } as const;

  assert.throws(
    () => createAvatarCaptionPlan({ ...input, avatarAsset: { id: "avatar-1", durationSeconds: 20 } }),
    /时长不足/u,
  );
  assert.throws(
    () => createAvatarCaptionPlan({ ...input, avatarScript: "好", avatarAsset: { id: "avatar-1", durationSeconds: 30 } }),
    /过短/u,
  );
});
