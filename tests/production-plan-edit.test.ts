import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductionPlanEdit,
  productionPlanResultV4Schema,
  type ProductionPlanConstraints,
  type ProductionPlanResultV3,
  type ProductionPlanResultV4,
} from "../packages/ai/src/index";

const constraints: ProductionPlanConstraints = {
  analysisTaskId: "task-1",
  mode: "montage",
  targetDurationSeconds: 20,
  textPreset: "classic_top",
  headlineText: "看得见的真实服务",
  subtitleTemplateId: "classic_line",
  allowedDecorationIds: ["arrow_right", "star_mark"],
  assets: [
    { id: "asset-image", role: "visual", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
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
    textOverlay: { primaryText: "看得见的真实服务", secondaryText: null, preset: "classic_top" },
    subtitle: {
      templateId: "classic_line",
      timing: { precision: "estimated", source: "script_estimate" },
      degradedFromTemplateId: null,
    },
    shots: [
      {
        order: 1,
        assetId: "asset-image",
        durationSeconds: 8,
        narration: "第一次到店，先看清服务过程。",
        caption: "先看清服务过程",
        fit: "cover",
        cues: [{ startMs: 0, endMs: 8000, text: "第一次到店，先看清服务过程。", emphasisWords: [], words: null }],
      },
      {
        order: 2,
        assetId: "asset-video",
        durationSeconds: 12,
        narration: "真实步骤逐一呈现，欢迎到店了解。",
        caption: "真实步骤逐一呈现",
        fit: "cover",
        cues: [{ startMs: 0, endMs: 12000, text: "真实步骤逐一呈现，欢迎到店了解。", emphasisWords: [], words: null }],
      },
    ],
    decorations: [
      { kind: "sticker", assetRef: "arrow_right", text: null, shotOrder: 1, startMs: 0, endMs: 8000, anchor: "middle_right", scale: 1, animation: "pop" },
    ],
  };
}

test("微调口播会按新字幕重算贴纸时间，不能把装饰静默清空", () => {
  const next = applyProductionPlanEdit({
    plan: plan(),
    constraints,
    edit: {
      expectedUpdatedAt: "token",
      shots: [{ order: 1, narration: "到店之后把服务步骤慢慢讲清楚，不要着急下结论。" }],
    },
  });

  assert.equal(next.decorations.length, 1);
  assert.equal(next.decorations[0]?.assetRef, "arrow_right");
  assert.equal(next.decorations[0]?.anchor, "middle_right");
  const firstCue = next.shots[0]?.cues[0];
  assert.ok(firstCue);
  assert.equal(next.decorations[0]?.startMs, firstCue.startMs);
  assert.equal(next.decorations[0]?.endMs, firstCue.endMs);
  assert.notEqual(next.shots[0]?.narration, plan().shots[0]?.narration);
});

/** 由 v3 夹具换算出的合法 v4 计划：镜头时长与 cue 相同，只是换成实测字段。 */
function v4Plan(): ProductionPlanResultV4 {
  const base = plan();
  return {
    schemaVersion: "production-plan.v4",
    source: { analysisTaskId: "task-1" },
    title: base.title,
    settings: { width: 720, height: 1280, fps: 30 },
    audio: base.audio,
    textOverlay: base.textOverlay,
    subtitle: {
      templateId: "classic_line",
      timing: { precision: "estimated", source: "tts_duration" },
      degradedFromTemplateId: null,
    },
    shots: base.shots.map((shot) => ({
      order: shot.order,
      assetId: shot.assetId,
      durationMs: Math.round(shot.durationSeconds * 1_000),
      sentenceId: `sentence-${shot.order}`,
      narration: shot.narration,
      caption: shot.caption,
      fit: shot.fit,
      cues: shot.cues,
    })),
    decorations: [],
  };
}

test("实测时长计划不能走目标时长微调旧路，如实拒绝", () => {
  assert.equal(productionPlanResultV4Schema.safeParse(v4Plan()).success, true, "夹具必须是合法的 v4 计划");
  assert.throws(
    () => applyProductionPlanEdit({ plan: v4Plan(), constraints, edit: { expectedUpdatedAt: "token" } }),
    /回分镜修改文案后重新配音/u,
  );
});
