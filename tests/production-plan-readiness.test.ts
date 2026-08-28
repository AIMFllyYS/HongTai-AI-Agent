import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectNarrationReadiness,
  inspectProductionPlanReadiness,
  inspectScriptStoryboardReadiness,
  MIN_MONTAGE_VISUAL_ASSETS,
  type ScriptStoryboard,
  type TtsTimedTrack,
} from "../packages/core/src/index";

test("montage readiness counts visual pictures, not music or total files", () => {
  const twoVisuals = inspectProductionPlanReadiness({
    mode: "montage",
    targetDurationSeconds: 30,
    assets: [
      { role: "visual", kind: "image" },
      { role: "visual", kind: "video", durationSeconds: 8 },
      { role: "music", kind: "audio", durationSeconds: 90 },
    ],
  });
  assert.deepEqual(twoVisuals, { ok: false, reason: "need-visuals", missingVisualCount: 1 });

  const ready = inspectProductionPlanReadiness({
    mode: "montage",
    targetDurationSeconds: 30,
    assets: [
      { role: "visual", kind: "image" },
      { role: "visual", kind: "image" },
      { role: "visual", kind: "video", durationSeconds: 8 },
      { role: "music", kind: "audio", durationSeconds: 90 },
    ],
  });
  assert.deepEqual(ready, { ok: true });
  assert.equal(MIN_MONTAGE_VISUAL_ASSETS, 3);
});

test("avatar readiness needs one video that covers the target and a script", () => {
  assert.deepEqual(inspectProductionPlanReadiness({
    mode: "avatar",
    targetDurationSeconds: 20,
    avatarScript: "到店看过程",
    assets: [{ role: "visual", kind: "image" }],
  }), { ok: false, reason: "need-avatar-video" });

  assert.deepEqual(inspectProductionPlanReadiness({
    mode: "avatar",
    targetDurationSeconds: 20,
    avatarScript: "到店看过程",
    assets: [{ role: "avatar", kind: "video", durationSeconds: 19.9 }],
  }), { ok: false, reason: "avatar-too-short", targetDurationSeconds: 20 });

  assert.deepEqual(inspectProductionPlanReadiness({
    mode: "avatar",
    targetDurationSeconds: 20,
    assets: [{ role: "avatar", kind: "video", durationSeconds: 20 }],
  }), { ok: false, reason: "need-avatar-script" });

  assert.deepEqual(inspectProductionPlanReadiness({
    mode: "avatar",
    targetDurationSeconds: 20,
    avatarScript: "到店看过程",
    assets: [{ role: "avatar", kind: "video", durationSeconds: 20 }],
  }), { ok: true });
});

const storyboard: ScriptStoryboard = {
  schemaVersion: "script-storyboard.v1",
  sentences: [
    { id: "sentence-1", text: "第一次到店总是没底。", estimatedMs: 2_500 },
    { id: "sentence-2", text: "我们把真实步骤拍下来。", estimatedMs: 2_750 },
  ],
};

function track(sentenceId: string): TtsTimedTrack {
  return { sentenceId, durationMs: 5_000, alignmentSource: "native" };
}

test("v4 分镜脚本就绪：脚本缺失或没有句子时阻塞，有句子即就绪", () => {
  assert.deepEqual(inspectScriptStoryboardReadiness({}), { ok: false, reason: "need-storyboard-sentences" });
  assert.deepEqual(
    inspectScriptStoryboardReadiness({ storyboard: { ...storyboard, sentences: [] } }),
    { ok: false, reason: "need-storyboard-sentences" },
    "类型允许空句子列表，就绪检查必须如实阻塞",
  );
  assert.deepEqual(inspectScriptStoryboardReadiness({ storyboard }), { ok: true });
});

test("v4 配音就绪：每句都要有实测音轨，缺的句子按 id 列出", () => {
  assert.deepEqual(
    inspectNarrationReadiness({ storyboard, tracks: [track("sentence-1")] }),
    { ok: false, reason: "need-narration-tracks", missingSentenceIds: ["sentence-2"] },
  );
  assert.deepEqual(
    inspectNarrationReadiness({ storyboard, tracks: [track("sentence-1"), track("sentence-2")] }),
    { ok: true },
  );
});

test("v4 配音就绪：脚本未就绪时先报脚本原因", () => {
  assert.deepEqual(
    inspectNarrationReadiness({ tracks: [track("sentence-1")] }),
    { ok: false, reason: "need-storyboard-sentences" },
  );
});

test("v4 配音就绪：音轨引用不存在的句子或同一句重复时按 mismatch 阻塞", () => {
  assert.deepEqual(
    inspectNarrationReadiness({ storyboard, tracks: [track("sentence-1"), track("sentence-9")] }),
    { ok: false, reason: "narration-track-mismatch", mismatchedSentenceIds: ["sentence-9"] },
  );
  assert.deepEqual(
    inspectNarrationReadiness({
      storyboard,
      tracks: [track("sentence-1"), track("sentence-1"), track("sentence-2")],
    }),
    { ok: false, reason: "narration-track-mismatch", mismatchedSentenceIds: ["sentence-1"] },
    "同一句的重复音轨说明状态与脚本脱节，即使句子已全覆盖也要阻塞",
  );
});
