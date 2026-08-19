import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "../packages/core/src/index";
import type { AiGenerateRequest, AiGenerateResult, AiProvider } from "../packages/ai/src/contracts/provider";
import type { ReplicaBlueprintInput } from "../packages/ai/src/contracts/replica-blueprint";
import { ReplicaBlueprintFlow } from "../packages/ai/src/flows/replica-blueprint/replica-blueprint-flow";
import {
  replicaBlueprintPrompt,
  replicaBlueprintRepairPrompt,
} from "../packages/ai/src/prompts/replica-blueprint";
import { replicaBlueprintResultSchema, type ReplicaBlueprintResponse } from "../packages/ai/src/schemas/replica-blueprint";
import type { ContentAnalysisResultV1 } from "../packages/ai/src/schemas/content-analysis";

function analysis(): ContentAnalysisResultV1 {
  return {
    schemaVersion: "content-analysis.v1",
    source: { taskId: "task-1", platform: "douyin", contentType: "video", sourceKind: "asr" },
    overview: { summary: "讲清门店服务流程", theme: "服务透明", targetAudiences: ["本地客户"], communicationGoal: "到店咨询" },
    hook: { type: "question", description: "先问顾客最担心什么", mechanism: "用疑问抓注意力", evidenceRefs: ["seg-1"] },
    painPoints: [{ description: "担心流程不透明", evidenceRefs: ["seg-1"] }],
    emotionalDrivers: [{ description: "被认真对待", evidenceRefs: ["seg-2"] }],
    structure: [
      { order: 1, role: "opening", summary: "提出顾客疑问", techniques: ["提问"], evidenceRefs: ["seg-1"] },
      { order: 2, role: "proof", summary: "展示服务过程", techniques: ["过程展示"], evidenceRefs: ["seg-2"] },
    ],
    coreClaims: [{ claim: "流程可以看得见", supportLevel: "explicit", evidenceRefs: ["seg-2"] }],
    style: { tones: ["平实"], pacing: "中速", languagePatterns: ["短句"], interactionMechanisms: ["提问"] },
    reusableTemplate: { formula: "疑问-过程-结果", steps: ["提问", "展示"], variableSlots: ["门店类型"], doNotCopy: ["原句"] },
    risks: [{ category: "exaggeration", level: "low", description: "避免绝对化承诺", evidenceRefs: ["seg-2"], suggestion: "改成可验证表述" }],
  };
}

function input(overrides: Partial<ReplicaBlueprintInput> = {}): ReplicaBlueprintInput {
  return {
    analysis: analysis(),
    evidenceUnits: [
      { id: "seg-1", text: "很多顾客第一次来都会担心流程不清楚。", startSeconds: 0, endSeconds: 4 },
      { id: "seg-2", text: "我们会把每一步都做给你看。", startSeconds: 4, endSeconds: 9 },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<ReplicaBlueprintResponse> = {}): ReplicaBlueprintResponse {
  return {
    premise: "把服务流程一步步拍出来就能复刻这条内容。",
    suggestedTemplateId: "keyword_pop",
    shots: [
      {
        order: 1,
        role: "opening",
        subject: "operator",
        visualDescription: "店员正面出镜，对着镜头说明今天要看什么",
        material: { kind: "video", contentHint: "店员出镜说开场问题", suggestedDurationSeconds: 6 },
        scriptDraft: "第一次来的朋友，最想知道的就是流程到底怎么走。",
        evidenceRefs: ["seg-1"],
      },
      {
        order: 2,
        role: "proof",
        subject: "environment",
        visualDescription: "从门口走进服务区的连续画面",
        material: { kind: "video", contentHint: "进店动线全景", suggestedDurationSeconds: 12 },
        scriptDraft: "从进门到落座，每一步都能自己看清楚。",
        evidenceRefs: ["seg-2"],
      },
    ],
    emptyReason: null,
    ...overrides,
  };
}

function provider(contents: readonly string[]): AiProvider & { readonly requests: AiGenerateRequest[] } {
  const requests: AiGenerateRequest[] = [];
  let index = 0;
  return {
    requests,
    async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
      requests.push(request);
      const content = contents[Math.min(index, contents.length - 1)] ?? "";
      index += 1;
      return { content, reasoning: "这段推理不应该出现在任何产物里", raw: { echo: content } };
    },
  };
}

async function run(contents: readonly string[], value = input()) {
  const dependencies = provider(contents);
  const flow = new ReplicaBlueprintFlow({ provider: dependencies });
  return { dependencies, result: await flow.run(value) };
}

async function rejection(contents: readonly string[], value = input()): Promise<TaskError> {
  try {
    await run(contents, value);
  } catch (error) {
    assert.ok(error instanceof TaskError, "失败必须是可分支的 TaskError");
    return error;
  }
  throw new Error("这次调用本应被拒绝");
}

test("蓝图把拆解转成可执行的素材需求清单，并逐镜留下真实证据引用", async () => {
  const { result } = await run([JSON.stringify(response())]);

  assert.equal(result.schemaVersion, "replica-blueprint.v1");
  assert.deepEqual(result.source, { analysisTaskId: "task-1", analysisSchemaVersion: "content-analysis.v1" });
  assert.equal(result.emptyReason, null);
  assert.deepEqual(result.shots.map((shot) => shot.order), [1, 2]);
  assert.deepEqual(result.shots.map((shot) => shot.material.kind), ["video", "video"]);
  assert.deepEqual(result.shots.map((shot) => shot.material.suggestedDurationSeconds), [6, 12]);
  for (const shot of result.shots) {
    assert.ok(shot.evidenceRefs.length > 0, "每个分镜都必须能追回原文证据");
  }
  // 清单本身不含任何已导入素材：素材还没拍，assetId 要等 #111 绑定。
  assert.doesNotMatch(JSON.stringify(result), /assetId/u);
  assert.ok(replicaBlueprintResultSchema.safeParse(result).success);
});

test("蓝图证据不足时给空清单并说明原因，而不是编造画面", async () => {
  const { result } = await run([JSON.stringify(response({
    shots: [],
    emptyReason: "转写只有一句寒暄，说不出任何可拍的画面。",
  }))]);

  assert.deepEqual(result.shots, []);
  assert.match(result.emptyReason ?? "", /说不出任何可拍的画面/u);
});

test("蓝图给出分镜时不能同时声明证据不足，空清单也不能没有原因", async () => {
  const both = await rejection([JSON.stringify(response({ emptyReason: "证据不足。" }))]);
  assert.equal(both.code, "AI_FORMAT_REPAIR_FAILED");

  const neither = await rejection([JSON.stringify(response({ shots: [], emptyReason: null }))]);
  assert.equal(neither.code, "AI_FORMAT_REPAIR_FAILED");
});

test("蓝图引用不存在的证据 id 时修一次仍失败，不产出可信外观的清单", async () => {
  const faked = JSON.stringify(response({
    shots: response().shots.map((shot) => ({ ...shot, evidenceRefs: ["seg-9"] })),
  }));
  const error = await rejection([faked]);

  assert.equal(error.code, "AI_FORMAT_REPAIR_FAILED");
  assert.equal(error.action, "retry");
});

test("蓝图修好证据引用后接受，修复提示只给合法 id", async () => {
  const faked = JSON.stringify(response({ shots: response().shots.map((shot) => ({ ...shot, evidenceRefs: ["seg-9"] })) }));
  const { dependencies, result } = await run([faked, JSON.stringify(response())]);

  assert.equal(dependencies.requests.length, 2, "正常路径最多一次生成加一次修复");
  assert.deepEqual(result.shots.flatMap((shot) => shot.evidenceRefs), ["seg-1", "seg-2"]);

  const repair = replicaBlueprintRepairPrompt(faked, input());
  assert.match(repair, /\["seg-1","seg-2"\]/u);
  assert.doesNotMatch(repair, /seg-9.*合法证据/su);
});

test("蓝图分镜序号必须连续，时长合计必须落在能成片的区间内", async () => {
  const gap = await rejection([JSON.stringify(response({
    shots: response().shots.map((shot, index) => ({ ...shot, order: index === 1 ? 3 : shot.order })),
  }))]);
  assert.equal(gap.code, "AI_FORMAT_REPAIR_FAILED");

  const tooShort = await rejection([JSON.stringify(response({
    shots: [{ ...response().shots[0]!, material: { kind: "video", contentHint: "开场", suggestedDurationSeconds: 3 } }],
  }))]);
  assert.equal(tooShort.code, "AI_FORMAT_REPAIR_FAILED");

  // 4 个 20 秒的分镜合计 80 秒，成片最长只有 60 秒，这份清单拍完也用不上。
  const tooLong = await rejection([JSON.stringify(response({
    shots: [1, 2, 3, 4].map((order) => ({
      ...response().shots[0]!,
      order,
      material: { kind: "video" as const, contentHint: `第 ${order} 段`, suggestedDurationSeconds: 20 },
    })),
  }))]);
  assert.equal(tooLong.code, "AI_FORMAT_REPAIR_FAILED");
});

test("蓝图脚本草稿照抄原文时被拒绝，与制作计划受同一条原创约束", async () => {
  const original = "很多顾客第一次来都会担心流程不清楚，我们会把每一步都做给你看。";
  const copied = JSON.stringify(response({
    shots: [{ ...response().shots[0]!, scriptDraft: "很多顾客第一次来都会担心流程不清楚。", material: { kind: "video", contentHint: "开场", suggestedDurationSeconds: 18 } }],
  }));

  const error = await rejection([copied], input({ originalSourceText: original }));
  assert.equal(error.code, "AI_FORMAT_REPAIR_FAILED");

  // 没有原文可比时不假装校验过原创性。
  const { result } = await run([copied], input());
  assert.equal(result.shots.length, 1);
});

test("蓝图选逐字点亮模板时降级为逐行，并留下用户原本的选择", async () => {
  const { result } = await run([JSON.stringify(response({ suggestedTemplateId: "karaoke_glow" }))]);

  assert.equal(result.subtitle.templateId, "classic_line", "还没有录音，不能承诺逐字点亮");
  assert.equal(result.subtitle.degradedFromTemplateId, "karaoke_glow");

  const kept = await run([JSON.stringify(response())]);
  assert.equal(kept.result.subtitle.templateId, "keyword_pop");
  assert.equal(kept.result.subtitle.degradedFromTemplateId, null);
});

test("蓝图没有证据可用时直接按缺产物失败，不调用模型", async () => {
  const dependencies = provider([JSON.stringify(response())]);
  const flow = new ReplicaBlueprintFlow({ provider: dependencies });

  await assert.rejects(() => flow.run(input({ evidenceUnits: [] })), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "TASK_ARTIFACT_MISSING");
    return true;
  });
  assert.equal(dependencies.requests.length, 0, "没有证据时不该白花一次模型调用");
});

test("蓝图提示词只注入真实证据，不注入标题作者，也不留供应商推理文本", async () => {
  const prompt = replicaBlueprintPrompt(input());

  assert.match(prompt, /很多顾客第一次来都会担心流程不清楚/u, "证据单元必须进提示词");
  assert.doesNotMatch(prompt, /reusableTemplate|doNotCopy/u, "话术模板不该被当成分镜素材来源");
  assert.match(prompt, /不得描述被拆解视频里的具体人物、门店、品牌或画面细节/u);
  assert.match(prompt, /不得输出疾病诊断、处方、概率、健康评分或医疗功效承诺/u);

  const { result } = await run([JSON.stringify(response())]);
  assert.doesNotMatch(JSON.stringify(result), /这段推理不应该出现在任何产物里/u);
});
