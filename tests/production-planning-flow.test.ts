import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionPlanningFlow,
  type AiGenerateRequest,
  type AiProvider,
  type ProductionPlanInput,
  type ProductionPlanResultV2,
} from "../packages/ai/src/index";

const input: ProductionPlanInput = {
  analysisTaskId: "task-1",
  brief: "为社区门店制作一条可信、克制的到店介绍视频",
  mode: "montage",
  originalSourceText: "我在济南寻找三到五位伙伴一起合作，我提供场地和货品，你负责投入时间。",
  headlineText: "看得见的真实服务",
  textPreset: "classic_top",
  targetDurationSeconds: 20,
  analysis: {
    schemaVersion: "content-analysis.v1",
    source: { taskId: "task-1", platform: "douyin", contentType: "video", sourceKind: "asr" },
    overview: { summary: "先呈现顾客痛点，再展示门店服务过程", theme: "门店服务", targetAudiences: ["附近居民"], communicationGoal: "促进到店了解" },
    hook: { type: "pain_point", description: "直接提出选择困难", mechanism: "引发共鸣", evidenceRefs: ["segment-0"] },
    painPoints: [{ description: "不了解服务过程", evidenceRefs: ["segment-0"] }],
    emotionalDrivers: [{ description: "降低尝试门槛", evidenceRefs: ["segment-0"] }],
    structure: [{ order: 1, role: "opening", summary: "提出问题", techniques: ["短句"], evidenceRefs: ["segment-0"] }],
    coreClaims: [{ claim: "展示真实过程有助于理解服务", supportLevel: "inferred", evidenceRefs: ["segment-0"] }],
    style: { tones: ["真实"], pacing: "紧凑", languagePatterns: ["短句"], interactionMechanisms: [] },
    reusableTemplate: { formula: "痛点-过程-行动", steps: ["提出痛点", "展示过程", "邀请了解"], variableSlots: ["门店服务"], doNotCopy: ["原视频具体措辞"] },
    risks: [],
  },
  assets: [
    { id: "asset-image", role: "visual", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
    { id: "asset-detail", role: "visual", kind: "image", mimeType: "image/png", displayName: "服务细节.png" },
    { id: "asset-video", role: "visual", kind: "video", mimeType: "video/mp4", displayName: "服务过程.mp4", durationSeconds: 12 },
  ],
};

function plan(assetId = "asset-image"): ProductionPlanResultV2 {
  return {
    schemaVersion: "production-plan.v2",
    source: { analysisTaskId: "task-1" },
    title: "看得见的门店服务",
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: { primaryText: "看得见的真实服务", secondaryText: "过程透明，表达克制", preset: "classic_top" },
    shots: [
      { order: 1, assetId, durationSeconds: 8, narration: "第一次到店，不知道服务过程是否适合自己？", caption: "先看清服务过程", fit: "cover" },
      { order: 2, assetId: "asset-video", durationSeconds: 12, narration: "我们把真实步骤逐一呈现，欢迎到店进一步了解。", caption: "真实步骤逐一呈现", fit: "cover" },
    ],
  };
}

class SequenceProvider implements AiProvider {
  readonly calls: AiGenerateRequest[] = [];

  constructor(private readonly responses: readonly string[]) {}

  async generate(request: AiGenerateRequest) {
    this.calls.push(request);
    return { content: this.responses[this.calls.length - 1] ?? "", reasoning: "" };
  }

  async transcribe(): Promise<string> { return ""; }
}

test("制作规划发现虚构素材时只修复一次并返回可执行计划", async () => {
  const provider = new SequenceProvider([
    JSON.stringify(plan("invented-asset")),
    JSON.stringify(plan()),
  ]);
  const flow = new ProductionPlanningFlow({ provider });

  const result = await flow.run(input);

  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]?.jsonSchema?.name, "production_plan_v2");
  assert.match(String(provider.calls[0]?.messages[0]?.content), /production-plan\.v2/u);
  assert.match(String(provider.calls[0]?.messages[0]?.content), /爆款原文（参考，不可作为口播）/u);
  assert.match(String(provider.calls[0]?.messages[0]?.content), /正式爆款拆解（参考，不可照抄）/u);
  assert.equal(result.shots[0]?.assetId, "asset-image");
});

test("制作规划发现连续照抄参考原文时会修复为原创口播", async () => {
  const copied = plan();
  copied.shots[0]!.narration = "我在济南寻找三到五位伙伴一起合作。";
  const provider = new SequenceProvider([JSON.stringify(copied), JSON.stringify(plan())]);

  const result = await new ProductionPlanningFlow({ provider }).run(input);

  assert.equal(provider.calls.length, 2);
  assert.equal(result.shots[0]?.narration, plan().shots[0]?.narration);
  assert.match(String(provider.calls[1]?.messages[0]?.content), /原创性/u);
});

test("制作规划拒绝来源、镜头顺序或总时长不一致的计划", async () => {
  const invalid = plan();
  invalid.source.analysisTaskId = "other-task";
  invalid.shots[1]!.order = 3;
  invalid.settings.durationSeconds = 19;
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);

  await assert.rejects(() => new ProductionPlanningFlow({ provider }).run(input), /修复/u);
  assert.equal(provider.calls.length, 2);
});

test("制作规划拒绝不受支持的时长和素材数量", async () => {
  await assert.rejects(
    () => new ProductionPlanningFlow({ provider: new SequenceProvider([]) }).run({ ...input, targetDurationSeconds: 61 }),
    /15.*60/u,
  );
  await assert.rejects(
    () => new ProductionPlanningFlow({ provider: new SequenceProvider([]) }).run({ ...input, assets: input.assets.slice(0, 1) }),
    /至少需要3/u,
  );
});

test("数字人口播模式只允许一个上传数字人视频，并保留原始口播的字幕计划", async () => {
  const avatarInput: ProductionPlanInput = {
    ...input,
    mode: "avatar",
    avatarScript: "欢迎来到我们的门店。今天带你看看真实服务过程。",
    assets: [{ id: "avatar-video", role: "avatar", kind: "video", mimeType: "video/mp4", displayName: "数字人口播.mp4", durationSeconds: 20 }],
  };
  const avatarPlan = plan("avatar-video");
  avatarPlan.shots[1]!.assetId = "avatar-video";
  const provider = new SequenceProvider([JSON.stringify(avatarPlan)]);

  const result = await new ProductionPlanningFlow({ provider }).run(avatarInput);

  assert.equal(result.shots.every((shot) => shot.assetId === "avatar-video"), true);
  assert.equal(result.audio.backgroundMusicAssetId, null);
  assert.match(String(provider.calls[0]?.messages[0]?.content), /数字人口播模式/u);
});
