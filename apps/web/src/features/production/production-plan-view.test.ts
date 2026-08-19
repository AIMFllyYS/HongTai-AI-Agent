import assert from "node:assert/strict";
import test from "node:test";
import { readProductionPlan } from "./production-plan-view.js";

const SHOT = {
  order: 1,
  assetId: "asset-1",
  durationSeconds: 10,
  narration: "先看门店真实的样子",
  caption: "真实门店",
  cues: [{ startMs: 0, endMs: 2_000, text: "真实门店" }],
};

function planWith(grounding?: unknown) {
  return {
    schemaVersion: "production-plan.v3",
    document: {
      settings: { durationSeconds: 10 },
      audio: { speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
      textOverlay: { primaryText: "真实门店" },
      shots: [SHOT],
      subtitle: { templateId: "classic_line", timing: { precision: "estimated", source: "script_estimate" } },
      ...(grounding === undefined ? {} : { grounding }),
    },
  };
}

test("没有记录看没看过画面时按盲配读，不能读成已经看过", () => {
  // Plans written before the field existed had no vision at all, so `blind` is the accurate reading
  // and the only safe default: claiming the copy was matched to real pictures would be a lie.
  assert.equal(readProductionPlan(planWith()).visualGrounding, "blind");
  assert.equal(readProductionPlan(planWith(null)).visualGrounding, "blind");
  assert.equal(readProductionPlan(planWith({ visual: "asset_insight" })).visualGrounding, "asset_insight");
  assert.deepEqual(readProductionPlan(planWith({ visual: "asset_insight" })).describedAssetIds, []);
  assert.equal(readProductionPlan(planWith({ visual: "以后新增的值" })).visualGrounding, "blind");
});

test("只有真的看过画面才列出素材编号", () => {
  const described = readProductionPlan(planWith({ visual: "asset_insight", describedAssetIds: ["asset-1", "asset-2"] }));
  assert.deepEqual(described.describedAssetIds, ["asset-1", "asset-2"]);

  // A blind or avatar plan describing assets would contradict itself; the list is dropped rather
  // than shown, because the count is what the screen tells the user.
  for (const visual of ["blind", "not_applicable"]) {
    const view = readProductionPlan(planWith({ visual, describedAssetIds: ["asset-1"] }));
    assert.equal(view.visualGrounding, visual);
    assert.deepEqual(view.describedAssetIds, []);
  }
});

test("旧计划仍然可读可微调，新增字段不会让它变成不可编辑", () => {
  const view = readProductionPlan({ schemaVersion: "production-plan.v2", document: planWith().document });
  assert.equal(view.editable, true);
  assert.equal(view.visualGrounding, "blind");
  assert.equal(view.shots.length, 1);
});
