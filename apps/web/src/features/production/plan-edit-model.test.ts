import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanUpdate,
  draftTotalMilliseconds,
  MAX_SHOT_MS,
  MIN_SHOT_MS,
  planDraftFrom,
  planDraftProblem,
  redistributeShotDuration,
  secondsFromMilliseconds,
  shortCueCount,
  shotDurationBounds,
  type ShotDraft,
} from "./plan-edit-model";
import { readProductionPlan } from "./production-plan-view";

function planDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "production-plan.v3",
    source: { analysisTaskId: "task-1" },
    title: "门店真实体验",
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: { primaryText: "看得见的真实服务", secondaryText: null, preset: "aqua_accent" },
    subtitle: { templateId: "classic_line", timing: { precision: "estimated", source: "script_estimate" }, degradedFromTemplateId: null },
    shots: [
      {
        order: 1, assetId: "asset-1", durationSeconds: 8, narration: "先看真实环境。", caption: "真实环境", fit: "cover",
        cues: [{ startMs: 0, endMs: 8_000, text: "先看真实环境", emphasisWords: ["真实"], words: null }],
      },
      {
        order: 2, assetId: "asset-2", durationSeconds: 12, narration: "再看服务过程。", caption: "服务过程", fit: "contain",
        cues: [{ startMs: 0, endMs: 12_000, text: "再看服务过程", emphasisWords: [], words: null }],
      },
    ],
    decorations: [],
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}) {
  const document = planDocument(overrides);
  return readProductionPlan({ schemaVersion: String(document.schemaVersion), document: document as never });
}

function draft(...milliseconds: readonly number[]): readonly ShotDraft[] {
  return milliseconds.map((value, index) => ({
    order: index + 1,
    milliseconds: value,
    narration: `第 ${index + 1} 句口播。`,
    caption: `标题 ${index + 1}`,
    assetId: `asset-${index + 1}`,
  }));
}

test("只读映射层按无类型文档读出可编辑视图，坏字段留空而不猜", () => {
  const plan = view();
  assert.equal(plan.editable, true);
  assert.equal(plan.targetDurationSeconds, 20);
  assert.equal(plan.shots.length, 2);
  assert.equal(plan.shots[0]?.cues[0]?.text, "先看真实环境");
  assert.deepEqual(plan.shots[0]?.cues[0]?.emphasisWords, ["真实"]);
  assert.equal(plan.shots[0]?.cues[0]?.hasWordTiming, false);
  assert.equal(plan.subtitle?.templateId, "classic_line");
  assert.equal(plan.subtitle?.degraded, false);

  const broken = view({ shots: [{ order: 1, assetId: "asset-1" }, "不是对象"], textOverlay: { primaryText: 42 } });
  assert.equal(broken.shots.length, 0, "缺字段的镜头必须被丢掉，不能补默认值");
  assert.equal(broken.headlineText, "");
  assert.equal(broken.editable, false, "读不出镜头就不能进微调");
});

test("v1 计划不可微调，与服务端划的界一致", () => {
  const plan = readProductionPlan({ schemaVersion: "production-plan.v1", document: planDocument({ schemaVersion: "production-plan.v1" }) as never });
  assert.equal(plan.editable, false);
});

test("降级过的字幕模板保留用户原本的选择，避免下次保存把它忘掉", () => {
  const plan = view({
    subtitle: { templateId: "classic_line", timing: { precision: "estimated", source: "script_estimate" }, degradedFromTemplateId: "karaoke_glow" },
  });
  assert.equal(plan.subtitle?.templateId, "classic_line", "真正烧录的是降级后的模板");
  assert.equal(plan.subtitle?.requestedTemplateId, "karaoke_glow");
  assert.equal(plan.subtitle?.degraded, true);
  assert.equal(planDraftFrom(plan).subtitleTemplateId, "karaoke_glow");
});

test("改一个镜头时长后其余镜头按比例吸收差值，毫秒总和始终精确", () => {
  const cases: readonly { readonly shots: readonly ShotDraft[]; readonly order: number; readonly ms: number; readonly total: number }[] = [
    { shots: draft(8_000, 12_000), order: 1, ms: 10_000, total: 20_000 },
    { shots: draft(8_000, 12_000), order: 2, ms: 1_000, total: 20_000 },
    { shots: draft(5_000, 5_000, 5_000, 5_000), order: 3, ms: 11_100, total: 20_000 },
    { shots: draft(3_333, 3_333, 3_334), order: 1, ms: 1_001, total: 10_000 },
    { shots: draft(7_500, 7_500, 15_000), order: 3, ms: 20_000, total: 30_000 },
  ];

  for (const { shots, order, ms, total } of cases) {
    const next = redistributeShotDuration({ shots, order, milliseconds: ms, totalMilliseconds: total });
    assert.equal(draftTotalMilliseconds(next), total, `${order} 号镜头改成 ${ms} 后总和必须仍是 ${total}`);
    for (const shot of next) {
      assert.ok(Number.isInteger(shot.milliseconds), "时长必须是整毫秒");
      assert.ok(shot.milliseconds >= MIN_SHOT_MS && shot.milliseconds <= MAX_SHOT_MS, `镜头 ${shot.order} 越界：${shot.milliseconds}`);
    }
  }
});

test("按步长吸收差值，用户读到的秒数仍然加得起来", () => {
  const next = redistributeShotDuration({ shots: draft(10_000, 10_000, 10_000), order: 1, milliseconds: 10_100, totalMilliseconds: 30_000 });
  assert.deepEqual(next.map((shot) => shot.milliseconds), [10_100, 10_000, 9_900]);

  const cases: readonly { readonly shots: readonly ShotDraft[]; readonly order: number; readonly ms: number; readonly total: number }[] = [
    // 滑杆可以停在任意毫秒；请求值必须先对齐步长，否则显示的秒数加不回总时长。
    { shots: draft(10_000, 10_000, 10_000), order: 1, ms: 10_150, total: 30_000 },
    { shots: draft(10_000, 10_000, 10_000), order: 2, ms: 12_049, total: 30_000 },
    // 旧计划的镜头本来就不在步长网格上（20 秒平均切三镜）。
    { shots: draft(6_667, 6_667, 6_666), order: 1, ms: 6_567, total: 20_000 },
    { shots: draft(8_005, 10_995, 11_000), order: 3, ms: 9_400, total: 30_000 },
  ];

  for (const { shots, order, ms, total } of cases) {
    const result = redistributeShotDuration({ shots, order, milliseconds: ms, totalMilliseconds: total });
    assert.equal(draftTotalMilliseconds(result), total, `${order} 号镜头改成 ${ms} 后毫秒总和必须仍是 ${total}`);
    const shown = result.map((shot) => Number((shot.milliseconds / 1_000).toFixed(1)));
    assert.equal(
      Number(shown.reduce((sum, value) => sum + value, 0).toFixed(1)),
      total / 1_000,
      `界面上显示的秒数之和必须等于总时长：${JSON.stringify(shown)}`,
    );
  }
});

test("超出可行范围的时长被夹到边界，而不是产出服务端必然拒绝的计划", () => {
  const shots = draft(8_000, 12_000);
  const bounds = shotDurationBounds({ shots, order: 1, totalMilliseconds: 20_000 });
  assert.equal(bounds.minMs, 1_000, "另一个镜头最多 20 秒，所以本镜头下限还是 1 秒");
  assert.equal(bounds.maxMs, 19_000, "另一个镜头至少 1 秒，所以本镜头最多 19 秒");

  const tooLong = redistributeShotDuration({ shots, order: 1, milliseconds: 20_000, totalMilliseconds: 20_000 });
  assert.equal(tooLong[0]?.milliseconds, 19_000);
  assert.equal(tooLong[1]?.milliseconds, 1_000);
  assert.equal(draftTotalMilliseconds(tooLong), 20_000);
});

test("只有一个镜头时时长跟着目标时长走，不给出无意义的调节范围", () => {
  const shots = draft(15_000);
  assert.deepEqual(shotDurationBounds({ shots, order: 1, totalMilliseconds: 15_000 }), { minMs: 15_000, maxMs: 15_000 });
  const next = redistributeShotDuration({ shots, order: 1, milliseconds: 9_000, totalMilliseconds: 15_000 });
  assert.equal(next[0]?.milliseconds, 15_000);
});

test("整毫秒时长换成秒之后仍能通过渲染器的毫秒判定", () => {
  for (const milliseconds of [1_000, 8_005, 8_100, 11_995, 19_999]) {
    const seconds = secondsFromMilliseconds(milliseconds);
    const roundTrip = seconds * 1_000;
    assert.ok(Math.abs(roundTrip - Math.round(roundTrip)) < 1e-6, `${seconds} 秒不是整毫秒`);
    assert.equal(Math.round(roundTrip), milliseconds);
  }
});

test("只提交用户真的动过的字段，没动过就不发请求", () => {
  const plan = view();
  const base = planDraftFrom(plan);
  assert.equal(buildPlanUpdate({ draft: base, plan, expectedUpdatedAt: "t0" }), undefined, "没有改动就不该产生一次写入");

  const update = buildPlanUpdate({
    draft: { ...base, shots: base.shots.map((shot) => shot.order === 1 ? { ...shot, narration: "换一句开场。" } : shot) },
    plan,
    expectedUpdatedAt: "t0",
  });
  assert.deepEqual(update, { expectedUpdatedAt: "t0", shots: [{ order: 1, narration: "换一句开场。" }] });
});

test("清空主文字按不可提交拒绝，而不是当成没改后被悄悄还原", () => {
  const plan = view();
  const base = planDraftFrom(plan);
  assert.equal(planDraftProblem(base), undefined);

  for (const headlineText of ["", "   "]) {
    const cleared = { ...base, headlineText };
    assert.match(planDraftProblem(cleared) ?? "", /主文字不能为空/u, "服务端会把空主文字读成“保持原值”，界面必须先拦住");
    // 同时改了别的字段也不能放过：否则保存会成功，但主文字被还原成旧值。
    const withNarration = { ...cleared, shots: cleared.shots.map((shot) => shot.order === 1 ? { ...shot, narration: "换一句开场。" } : shot) };
    assert.match(planDraftProblem(withNarration) ?? "", /主文字不能为空/u);
  }

  const renamed = buildPlanUpdate({ draft: { ...base, headlineText: "换一个主文字" }, plan, expectedUpdatedAt: "t0" });
  assert.deepEqual(renamed, { expectedUpdatedAt: "t0", headlineText: "换一个主文字" });
});

test("取消背景音乐时不同时发音量，避免服务端按冲突拒绝", () => {
  const plan = view({ audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: "music-1", backgroundMusicVolume: 0.2 } });
  const base = planDraftFrom(plan);
  const update = buildPlanUpdate({
    draft: { ...base, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    plan,
    expectedUpdatedAt: "t0",
  });
  assert.deepEqual(update, { expectedUpdatedAt: "t0", backgroundMusicAssetId: null });
});

test("微调始终保持镜头数量与顺序，也不会提交计划里没有的镜头", () => {
  const shots = draft(5_000, 5_000, 10_000);
  const next = redistributeShotDuration({ shots, order: 2, milliseconds: 12_000, totalMilliseconds: 20_000 });
  assert.deepEqual(next.map((shot) => shot.order), [1, 2, 3], "重分配不能增删或重排镜头");

  const plan = view();
  const base = planDraftFrom(plan);
  const update = buildPlanUpdate({
    draft: { ...base, shots: [...base.shots, { order: 9, milliseconds: 3_000, narration: "凭空多出的镜头。", caption: "多余", assetId: "asset-1" }] },
    plan,
    expectedUpdatedAt: "t0",
  });
  assert.equal(update, undefined, "计划里没有的镜头不能被提交出去");
});

test("按镜头数出偏短字幕，好让界面如实提示而不是悄悄接受", () => {
  const plan = view({
    shots: [{
      order: 1, assetId: "asset-1", durationSeconds: 1, narration: "很长的一句口播。", caption: "标题", fit: "cover",
      cues: [
        { startMs: 0, endMs: 500, text: "很长的一句", emphasisWords: [], words: null },
        { startMs: 500, endMs: 1_000, text: "口播", emphasisWords: [], words: null },
      ],
    }],
  });
  assert.equal(shortCueCount(plan.shots[0]!), 2);
  assert.equal(shortCueCount(view().shots[0]!), 0);
});
