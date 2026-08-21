import assert from "node:assert/strict";
import test from "node:test";

import { inspectProductionPlanReadiness, MIN_MONTAGE_VISUAL_ASSETS } from "../packages/core/src/index";

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
