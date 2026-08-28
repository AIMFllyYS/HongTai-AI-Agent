import assert from "node:assert/strict";
import test from "node:test";

import {
  ScriptGenerationFlow,
  type AiGenerateRequest,
  type AiProvider,
  type ContentAnalysisResultV1,
  type ScriptGenerationInput,
} from "../packages/ai/src/index";

const montageInput: ScriptGenerationInput = {
  brief: "做一条让附近居民放心到店的推拿服务介绍视频",
  mode: "montage",
  assets: [
    { id: "asset-image", kind: "image", role: "visual" },
    { id: "asset-detail", kind: "image", role: "visual", insight: { description: "店员在明亮前台整理艾灸用具", tags: ["前台"] } },
    { id: "asset-music", kind: "audio", role: "music" },
  ],
};

const analysis: ContentAnalysisResultV1 = {
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
};

/** 模型草稿：第一句的素材绑定可注入指定 id，其余固定。 */
function draft(firstAssetId?: string) {
  return {
    purpose: "门店服务介绍",
    sentences: [
      { text: "第一次到店总是没底？", ...(firstAssetId === undefined ? {} : { assetId: firstAssetId }), stickerId: "arrow_right" },
      { text: "我们把真实服务过程逐一拍给你看。", assetId: "asset-detail" },
      { text: "欢迎到店了解，再决定要不要来。" },
    ],
  };
}

const avatarInput: ScriptGenerationInput = {
  brief: "把这段口播剪成介绍视频",
  mode: "avatar",
  assets: [{ id: "avatar-video", kind: "video", role: "avatar", durationSeconds: 20 }],
};

const avatarDraft = {
  sentences: [
    { text: "欢迎来到我们的门店。", assetId: "avatar-video" },
    { text: "今天带你看看真实的服务过程。", assetId: "avatar-video" },
  ],
};

class SequenceProvider implements AiProvider {
  readonly calls: AiGenerateRequest[] = [];

  constructor(private readonly responses: readonly string[]) {}

  async generate(request: AiGenerateRequest) {
    this.calls.push(request);
    return { content: this.responses[this.calls.length - 1] ?? "", reasoning: "" };
  }

  async transcribe(): Promise<string> { return ""; }
}

test("分镜脚本把模型草稿组装成版本化契约，id 与预估时长都在本地生成", async () => {
  const provider = new SequenceProvider([JSON.stringify(draft())]);

  const result = await new ScriptGenerationFlow({ provider }).run(montageInput);

  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.jsonSchema?.name, "script_storyboard_v1");
  assert.match(String(provider.calls[0]?.messages[0]?.content), /不要输出id、时长或毫秒数/u);
  assert.equal(result.schemaVersion, "script-storyboard.v1");
  assert.equal(result.purpose, "门店服务介绍");
  assert.equal(result.sentences.length, 3);
  assert.deepEqual(
    result.sentences.map((sentence) => sentence.text),
    draft().sentences.map((sentence) => sentence.text),
  );
  assert.equal(new Set(result.sentences.map((sentence) => sentence.id)).size, 3, "句子 id 必须唯一");
  assert.equal(result.sentences[0]?.estimatedMs, 2_500, "预估时长按每字 250 毫秒估算");
  assert.equal(result.sentences[0]?.stickerId, "arrow_right");
  assert.equal(result.sentences[2]?.assetId, undefined, "无合适素材时不编造绑定");
});

test("分镜脚本发现虚构素材时只修复一次", async () => {
  const provider = new SequenceProvider([JSON.stringify(draft("invented-asset")), JSON.stringify(draft())]);

  const result = await new ScriptGenerationFlow({ provider }).run(montageInput);

  assert.equal(provider.calls.length, 2);
  assert.match(String(provider.calls[1]?.messages[0]?.content), /只修复分镜脚本/u);
  assert.equal(result.sentences[0]?.text, "第一次到店总是没底？");
});

test("分镜脚本把音频素材挡在画面绑定之外", async () => {
  const provider = new SequenceProvider([JSON.stringify(draft("asset-music")), JSON.stringify(draft())]);

  const result = await new ScriptGenerationFlow({ provider }).run(montageInput);

  assert.equal(provider.calls.length, 2);
  assert.equal(result.sentences[0]?.assetId, undefined);
});

test("清单外的贴纸建议触发修复轮", async () => {
  const invented = { sentences: [{ text: "第一句。", stickerId: "invented_sticker" }] };
  const provider = new SequenceProvider([JSON.stringify(invented), JSON.stringify(draft())]);

  const result = await new ScriptGenerationFlow({ provider }).run(montageInput);

  assert.equal(provider.calls.length, 2);
  assert.equal(result.sentences[0]?.stickerId, "arrow_right");
});

test("修复后仍不合格则如实失败，不吞掉第二次错误", async () => {
  const bad = JSON.stringify(draft("invented-asset"));
  const provider = new SequenceProvider([bad, bad]);

  await assert.rejects(() => new ScriptGenerationFlow({ provider }).run(montageInput), /修复/u);
  assert.equal(provider.calls.length, 2);
});

test("空需求直接拒绝，不发起模型调用", async () => {
  const provider = new SequenceProvider([]);

  await assert.rejects(
    () => new ScriptGenerationFlow({ provider }).run({ ...montageInput, brief: "  " }),
    /制作需求不能为空/u,
  );
  assert.equal(provider.calls.length, 0);
});

test("没有参考拆解也可以直接发起，prompt 如实说明并约束未识别素材", async () => {
  const provider = new SequenceProvider([JSON.stringify(draft())]);

  await new ScriptGenerationFlow({ provider }).run(montageInput);

  const prompt = String(provider.calls[0]?.messages[0]?.content);
  assert.match(prompt, /本次没有参考拆解结果/u);
  assert.match(prompt, /只能讲insight里确实提到的东西/u);
  assert.match(prompt, /以下素材没有画面识别结果/u);
  assert.match(prompt, /不得自造文件名/u);
  assert.match(prompt, /整片最多6个贴纸/u, "AI 逐句建议贴纸，必须提前知道全片上限，减少服务端截断");
});

test("带参考拆解时只吸收结构，不照抄措辞", async () => {
  const provider = new SequenceProvider([JSON.stringify(draft())]);

  await new ScriptGenerationFlow({ provider }).run({ ...montageInput, analysis });

  const prompt = String(provider.calls[0]?.messages[0]?.content);
  assert.match(prompt, /参考拆解仅供结构与思路参考/u);
  assert.match(prompt, /不得照抄或近似改写/u);
});

test("口播照抄参考原文连续十二字时在生成期触发修复轮，不再等合成期", async () => {
  const source = "这家推拿店的老师傅手法特别厉害，第一次来就感觉整个人都轻松了。";
  const copied = { sentences: [{ text: "老师傅手法特别厉害，第一次来就感觉", assetId: "asset-image" }] };
  const provider = new SequenceProvider([JSON.stringify(copied), JSON.stringify(draft())]);

  const result = await new ScriptGenerationFlow({ provider }).run({ ...montageInput, originalSourceText: source });

  assert.equal(provider.calls.length, 2, "照抄命中后走一次修复轮");
  assert.deepEqual(
    result.sentences.map((sentence) => sentence.text),
    draft().sentences.map((sentence) => sentence.text),
  );
});

test("修复轮仍照抄原文时如实失败；没有参考原文时不做原创性校验", async () => {
  const source = "这家推拿店的老师傅手法特别厉害，第一次来就感觉整个人都轻松了。";
  const copied = JSON.stringify({ sentences: [{ text: "老师傅手法特别厉害，第一次来就感觉", assetId: "asset-image" }] });
  const provider = new SequenceProvider([copied, copied]);

  await assert.rejects(
    () => new ScriptGenerationFlow({ provider }).run({ ...montageInput, originalSourceText: source }),
    /修复后仍不符合执行约束|连续重复/u,
  );

  const noReference = new SequenceProvider([copied]);
  await new ScriptGenerationFlow({ provider: noReference }).run(montageInput);
  assert.equal(noReference.calls.length, 1, "没有参考原文时同一草稿直接通过");
});

test("数字人模式逐句必须绑数字人视频，漏绑走修复轮；口播不受视频时长约束", async () => {
  const unbound = {
    sentences: [
      { text: "欢迎来到我们的门店。" },
      { text: "今天带你看看真实的服务过程。", assetId: "avatar-video" },
    ],
  };
  const provider = new SequenceProvider([JSON.stringify(unbound), JSON.stringify(avatarDraft)]);

  const result = await new ScriptGenerationFlow({ provider }).run(avatarInput);

  assert.equal(provider.calls.length, 2);
  assert.equal(result.sentences.every((sentence) => sentence.assetId === "avatar-video"), true);
  const prompt = String(provider.calls[0]?.messages[0]?.content);
  assert.match(prompt, /数字人模式/u);
  assert.match(prompt, /口播时长不受该视频长度约束/u, "短数字人视频配长配音是常态，脚本不被源时长卡死");
  assert.doesNotMatch(prompt, /不得超过口播视频时长/u);
});

test("数字人模式缺视频或缺时长直接拒绝", async () => {
  await assert.rejects(
    () => new ScriptGenerationFlow({ provider: new SequenceProvider([]) }).run({ ...avatarInput, assets: [] }),
    /数字人模式需要且只能使用一个数字人视频/u,
  );

  const undated = new SequenceProvider([]);
  await assert.rejects(
    () => new ScriptGenerationFlow({ provider: undated }).run({
      ...avatarInput,
      assets: [{ id: "avatar-video", kind: "video", role: "avatar" }],
    }),
    /数字人视频缺少时长信息/u,
  );
  assert.equal(undated.calls.length, 0);
});

test("流式进度事件透传给 provider，并携带 generating/repairing 阶段标注", async () => {
  const phases: string[] = [];
  const provider: AiProvider = {
    generate: async (request) => {
      await request.onEvent?.({ type: "reasoning_delta", delta: "先想结构" });
      await request.onEvent?.({ type: "content_delta", delta: "片段" });
      const invalid = provider.calls.length === 0;
      provider.calls.push(request);
      return { content: invalid ? JSON.stringify(draft("invented-asset")) : JSON.stringify(draft()), reasoning: "" };
    },
    transcribe: async () => "",
    calls: [] as AiGenerateRequest[],
  } as AiProvider & { calls: AiGenerateRequest[] };

  await new ScriptGenerationFlow({
    provider,
    onEvent: (event, meta) => {
      if (event.type === "reasoning_delta" || event.type === "content_delta") phases.push(meta.phase);
    },
  }).run(montageInput);

  assert.equal(typeof provider.calls[0]?.onEvent, "function");
  assert.deepEqual(phases, ["generating", "generating", "repairing", "repairing"], "初稿事件标 generating，修复轮事件标 repairing");
});
