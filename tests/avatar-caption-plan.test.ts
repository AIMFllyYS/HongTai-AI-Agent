import assert from "node:assert/strict";
import test from "node:test";

import { createAvatarCaptionPlan } from "../packages/ai/src/index";

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
