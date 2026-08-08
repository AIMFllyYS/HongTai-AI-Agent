import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionPlanningFlow,
  type AiGenerateRequest,
  type AiProvider,
  type ProductionPlanInput,
  type ProductionPlanResultV1,
} from "../packages/ai/src/index";

const input: ProductionPlanInput = {
  analysisTaskId: "task-1",
  brief: "为社区门店制作一条可信、克制的到店介绍视频",
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
    { id: "asset-image", kind: "image", mimeType: "image/jpeg", displayName: "门店.jpg" },
    { id: "asset-detail", kind: "image", mimeType: "image/png", displayName: "服务细节.png" },
    { id: "asset-video", kind: "video", mimeType: "video/mp4", displayName: "服务过程.mp4", durationSeconds: 12 },
  ],
};

function plan(assetId = "asset-image"): ProductionPlanResultV1 {
  return {
    schemaVersion: "production-plan.v1",
    source: { analysisTaskId: "task-1" },
    title: "看得见的门店服务",
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: 20 },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
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
  assert.equal(provider.calls[0]?.jsonSchema?.name, "production_plan_v1");
  assert.match(String(provider.calls[0]?.messages[0]?.content), /production-plan\.v1/u);
  assert.equal(result.shots[0]?.assetId, "asset-image");
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
    /3.*12/u,
  );
});
