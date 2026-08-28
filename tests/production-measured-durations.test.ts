import assert from "node:assert/strict";
import test from "node:test";

import {
  checkMeasuredProductionDurations,
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_MEASURED_SHOT_DURATION_MS,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  MIN_SHOT_DURATION_SECONDS,
} from "../packages/core/src/index";

test("v3 边界常量保持原语义，存量调用方不受 v4 影响", () => {
  assert.equal(MAX_SHOTS_PER_PRODUCTION, 12);
  assert.equal(MIN_SHOT_DURATION_SECONDS, 1);
  assert.equal(MAX_SHOT_DURATION_SECONDS, 20);
  assert.equal(MIN_PRODUCTION_DURATION_SECONDS, 15);
  assert.equal(MAX_PRODUCTION_DURATION_SECONDS, 60);
  assert.equal(MIN_MONTAGE_VISUAL_ASSETS, 3);
  assert.equal(MIN_MEASURED_SHOT_DURATION_MS, 300, "v4 结构下限放宽到 300ms");
});

test("实测时长全部落在边界内时通过，不携带任何违规", () => {
  const check = checkMeasuredProductionDurations({ shotDurationMs: [5_000, 6_000, 7_000] });
  assert.deepEqual(check, { ok: true, softViolations: [] });
});

test("边界值本身不构成违规：300ms 下限、20s 单镜上限、15s/60s 总时长", () => {
  const atFloor = checkMeasuredProductionDurations({ shotDurationMs: [MIN_MEASURED_SHOT_DURATION_MS, 14_700] });
  assert.equal(atFloor.ok, true, "300ms 恰好等于结构下限");
  assert.deepEqual(atFloor.softViolations, [], "总量恰为 15 秒时不提示");

  const atShotCeiling = checkMeasuredProductionDurations({ shotDurationMs: [20_000, 400, 400, 400] });
  assert.equal(atShotCeiling.ok, true, "单镜恰为 20 秒时不软违规");
  assert.deepEqual(atShotCeiling.softViolations, []);

  const atTotalCeiling = checkMeasuredProductionDurations({ shotDurationMs: [20_000, 20_000, 20_000] });
  assert.equal(atTotalCeiling.ok, true, "总量恰为 60 秒时不软违规");
  assert.deepEqual(atTotalCeiling.softViolations, []);
});

test("总时长 15–60 秒是软边界：超界仍 ok，但列出 soft violation", () => {
  const tooShort = checkMeasuredProductionDurations({ shotDurationMs: [4_000, 4_000, 4_000] });
  assert.equal(tooShort.ok, true, "总量 12 秒仍可继续（用户确认或回改文稿）");
  assert.deepEqual(tooShort.softViolations, [{ reason: "total-too-short", kind: "soft", totalDurationMs: 12_000 }]);

  const tooLong = checkMeasuredProductionDurations({ shotDurationMs: [21_000, 20_000, 20_000] });
  assert.equal(tooLong.ok, true, "总量 61 秒仍可继续");
  assert.deepEqual(tooLong.softViolations, [
    { reason: "shot-too-long", kind: "soft", shotIndex: 1, durationMs: 21_000 },
    { reason: "total-too-long", kind: "soft", totalDurationMs: 61_000 },
  ]);
});

test("单镜超过 20 秒是软违规，并标注具体镜头位置", () => {
  const check = checkMeasuredProductionDurations({ shotDurationMs: [5_000, 25_000, 30_000] });
  assert.equal(check.ok, true);
  assert.deepEqual(check.softViolations, [
    { reason: "shot-too-long", kind: "soft", shotIndex: 2, durationMs: 25_000 },
    { reason: "shot-too-long", kind: "soft", shotIndex: 3, durationMs: 30_000 },
  ]);
});

test("结构违规是硬违规：低于 300ms、非法时长、镜头数越界都会拒绝", () => {
  const tooShortShot = checkMeasuredProductionDurations({ shotDurationMs: [200, 5_000, 6_000] });
  assert.equal(tooShortShot.ok, false);
  if (tooShortShot.ok) return;
  assert.deepEqual(tooShortShot.hardViolations, [
    { reason: "shot-too-short", kind: "hard", shotIndex: 1, durationMs: 200 },
  ]);

  const invalidDuration = checkMeasuredProductionDurations({ shotDurationMs: [5_000, 0, 6_000] });
  assert.equal(invalidDuration.ok, false);
  if (invalidDuration.ok) return;
  assert.equal(invalidDuration.hardViolations[0]?.reason, "shot-duration-invalid");

  const empty = checkMeasuredProductionDurations({ shotDurationMs: [] });
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.deepEqual(empty.hardViolations, [{ reason: "shot-count-out-of-range", kind: "hard" }]);

  const tooManyShots = checkMeasuredProductionDurations({
    shotDurationMs: Array.from({ length: MAX_SHOTS_PER_PRODUCTION + 1 }, () => 2_000),
  });
  assert.equal(tooManyShots.ok, false, "镜头数沿用 12 上限，13 镜拒绝");
  if (tooManyShots.ok) return;
  assert.equal(tooManyShots.hardViolations[0]?.reason, "shot-count-out-of-range");
});

test("硬违规与软违规同时存在时，两类都如实列出，不互相掩盖", () => {
  const check = checkMeasuredProductionDurations({ shotDurationMs: [200, 25_000, 25_000, 25_000] });
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.hardViolations.length, 1);
  assert.equal(check.hardViolations[0]?.reason, "shot-too-short");
  assert.equal(check.softViolations.length, 4);
  assert.ok(check.softViolations.some((violation) => violation.reason === "shot-too-long"));
  assert.ok(check.softViolations.some((violation) => violation.reason === "total-too-long"));
});

test("没有有效镜头时不叠加误导性的总时长提示", () => {
  const check = checkMeasuredProductionDurations({ shotDurationMs: [] });
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.ok(
    check.softViolations.every((violation) => violation.reason !== "total-too-short"),
    "0 个镜头时总量必然不足，但这属于结构问题，不该报总量软提示",
  );
});
