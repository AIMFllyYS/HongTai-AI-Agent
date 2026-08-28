import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_AVATAR_SOURCE_DURATION_MS,
  planAvatarSourceWindows,
  RECOMMENDED_AVATAR_SOURCE_DURATION_MS,
} from "../packages/core/src/index";

test("常量：源视频 2 秒硬下限、5 秒建议下限", () => {
  assert.equal(MIN_AVATAR_SOURCE_DURATION_MS, 2_000);
  assert.equal(RECOMMENDED_AVATAR_SOURCE_DURATION_MS, 5_000);
});

test("镜头时长总和不超过源时长时顺序消费，单窗、游标跨镜头连续", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 30_000, shotDurationMs: [6_000, 5_000] });
  assert.deepEqual(result, {
    ok: true,
    shots: [
      { shotIndex: 1, durationMs: 6_000, windows: [{ startMs: 0, endMs: 6_000 }] },
      { shotIndex: 2, durationMs: 5_000, windows: [{ startMs: 6_000, endMs: 11_000 }] },
    ],
    softViolations: [],
  });
});

test("总和恰好等于源时长时消费到尾，下一镜头从 0 重新开始", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [5_000, 4_000, 3_000] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.shots.map((shot) => shot.windows), [
    [{ startMs: 0, endMs: 5_000 }],
    [{ startMs: 5_000, endMs: 9_000 }],
    [{ startMs: 9_000, endMs: 10_000 }, { startMs: 0, endMs: 2_000 }],
  ]);
});

test("单镜头跨尾拆两窗：6s+5s 配 10s 源，第二镜头是 [6,10]+[0,1]", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [6_000, 5_000] });
  assert.deepEqual(result, {
    ok: true,
    shots: [
      { shotIndex: 1, durationMs: 6_000, windows: [{ startMs: 0, endMs: 6_000 }] },
      {
        shotIndex: 2,
        durationMs: 5_000,
        windows: [{ startMs: 6_000, endMs: 10_000 }, { startMs: 0, endMs: 1_000 }],
      },
    ],
    softViolations: [],
  });
});

test("单镜头长于整个源视频时循环拼凑延长：25s 镜头配 10s 源得 [0,10]+[0,10]+[0,5]", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [25_000] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.shots[0]?.windows, [
    { startMs: 0, endMs: 10_000 },
    { startMs: 0, endMs: 10_000 },
    { startMs: 0, endMs: 5_000 },
  ]);
});

test("连续多镜头累计跨多圈，游标始终延续上一镜头的停止位置", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 4_000, shotDurationMs: [3_000, 3_000, 3_000] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.shots.map((shot) => shot.windows), [
    [{ startMs: 0, endMs: 3_000 }],
    [{ startMs: 3_000, endMs: 4_000 }, { startMs: 0, endMs: 2_000 }],
    [{ startMs: 2_000, endMs: 4_000 }, { startMs: 0, endMs: 1_000 }],
  ]);
});

test("每个镜头的窗口时长之和恒等于该镜头实测时长（守恒）", () => {
  const result = planAvatarSourceWindows({
    sourceDurationMs: 7_000,
    shotDurationMs: [9_000, 2_500, 12_000, 1_000],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const [index, expected] of result.shots.entries()) {
    const total = expected.windows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0);
    assert.equal(total, [9_000, 2_500, 12_000, 1_000][index]);
  }
  // 窗口本身也必须落在源范围内且不为空。
  for (const shot of result.shots) {
    for (const window of shot.windows) {
      assert.ok(window.startMs >= 0 && window.endMs <= 7_000 && window.endMs > window.startMs);
    }
  }
});

test("源视频低于 2 秒是硬违规（避免频闪式快速循环），不产出任何窗口", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 1_500, shotDurationMs: [5_000] });
  assert.deepEqual(result, {
    ok: false,
    shots: [],
    hardViolations: [{ reason: "avatar-source-too-short", kind: "hard", sourceDurationMs: 1_500 }],
    softViolations: [],
  });
});

test("源视频 2–5 秒可用但给软提示；恰好 5 秒是建议值不提示", () => {
  const short = planAvatarSourceWindows({ sourceDurationMs: 4_000, shotDurationMs: [3_000] });
  assert.equal(short.ok, true, "4 秒源可以正常规划窗口");
  assert.deepEqual(short.softViolations, [
    { reason: "avatar-source-short", kind: "soft", sourceDurationMs: 4_000 },
  ]);
  assert.deepEqual(short.shots, [
    { shotIndex: 1, durationMs: 3_000, windows: [{ startMs: 0, endMs: 3_000 }] },
  ]);

  const atFloor = planAvatarSourceWindows({ sourceDurationMs: MIN_AVATAR_SOURCE_DURATION_MS, shotDurationMs: [3_000] });
  assert.equal(atFloor.ok, true, "恰好 2 秒不是硬违规");
  assert.deepEqual(atFloor.softViolations, [
    { reason: "avatar-source-short", kind: "soft", sourceDurationMs: MIN_AVATAR_SOURCE_DURATION_MS },
  ], "恰好 2 秒仍算偏短（每 2 秒循环一次），给软提示");

  const atRecommended = planAvatarSourceWindows({
    sourceDurationMs: RECOMMENDED_AVATAR_SOURCE_DURATION_MS,
    shotDurationMs: [3_000],
  });
  assert.deepEqual(atRecommended.softViolations, [], "恰好 5 秒不触发偏短提示");
});

test("源时长非法（0、负数、非有限值）是硬违规，附上原始值供界面提示", () => {
  for (const invalid of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = planAvatarSourceWindows({ sourceDurationMs: invalid, shotDurationMs: [3_000] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.hardViolations, [
      { reason: "avatar-source-duration-invalid", kind: "hard", sourceDurationMs: invalid },
    ]);
    assert.deepEqual(result.shots, []);
  }
});

test("镜头时长非法是硬违规：不产出窗口，不进入游标算法", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [3_000, 0, 5_000] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.hardViolations, [
    { reason: "avatar-shot-duration-invalid", kind: "hard", shotIndex: 2, durationMs: 0 },
  ]);
  assert.deepEqual(result.shots, []);
  assert.deepEqual(result.softViolations, [], "镜头问题不牵连源时长提示");
});

test("空镜头列表规划成功且无窗口：镜头数校验属于 checkMeasuredProductionDurations 的职责", () => {
  const result = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [] });
  assert.deepEqual(result, { ok: true, shots: [], softViolations: [] });
});

test("纯函数：连续调用互不影响，游标不泄漏到下一次规划", () => {
  const first = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [8_000] });
  const second = planAvatarSourceWindows({ sourceDurationMs: 10_000, shotDurationMs: [5_000] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.shots[0]?.windows, [{ startMs: 0, endMs: 5_000 }], "第二次调用从头消费");
  assert.equal(first.ok, true);
});
