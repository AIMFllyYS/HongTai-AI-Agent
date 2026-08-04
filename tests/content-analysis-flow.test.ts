import assert from "node:assert/strict";
import test from "node:test";
import {
  ContentAnalysisFlow,
  type AiGenerateRequest,
  type AiProvider,
  type ContentAnalysisInput,
  type ContentAnalysisResultV1,
  type ContentAnalysisStore,
} from "../packages/ai/src/index";

const input: ContentAnalysisInput = {
  taskId: "task-1",
  platform: "bilibili",
  contentType: "video",
  sourceKind: "asr",
  title: "测试内容",
  author: "测试作者",
  evidenceUnits: [{ id: "segment-0", text: "开头提出用户痛点", startSeconds: 0, endSeconds: 5 }],
};

function resultWithReference(reference: string): ContentAnalysisResultV1 {
  return {
    schemaVersion: "content-analysis.v1",
    source: { taskId: "task-1", platform: "bilibili", contentType: "video", sourceKind: "asr" },
    overview: { summary: "围绕用户痛点展开", theme: "内容创作", targetAudiences: ["门店经营者"], communicationGoal: "提供方法" },
    hook: { type: "pain_point", description: "直接提出痛点", mechanism: "引发共鸣", evidenceRefs: [reference] },
    painPoints: [{ description: "缺少内容方法", evidenceRefs: [reference] }],
    emotionalDrivers: [{ description: "降低焦虑", evidenceRefs: [reference] }],
    structure: [{ order: 1, role: "opening", summary: "提出问题", techniques: ["直接提问"], evidenceRefs: [reference] }],
    coreClaims: [{ claim: "需要先明确受众", supportLevel: "explicit", evidenceRefs: [reference] }],
    style: { tones: ["直接"], pacing: "紧凑", languagePatterns: ["短句"], interactionMechanisms: ["提问"] },
    reusableTemplate: { formula: "痛点-方法-行动", steps: ["提出痛点", "给出方法"], variableSlots: ["行业痛点"], doNotCopy: ["原作者具体措辞"] },
    risks: [{ category: "unsupported_claim", level: "low", description: "需要核对事实依据", evidenceRefs: [reference], suggestion: "补充可靠来源" }],
  };
}

class MemoryContentStore implements ContentAnalysisStore {
  saved: ContentAnalysisResultV1 | undefined;
  run: import("../packages/ai/src/index").ContentAnalysisRunRecord | undefined;
  failedRun: import("../packages/ai/src/index").ContentAnalysisRunRecord | undefined;
  async loadInput(): Promise<ContentAnalysisInput> { return input; }
  async saveResult(_taskId: string, result: ContentAnalysisResultV1, run: import("../packages/ai/src/index").ContentAnalysisRunRecord): Promise<void> {
    this.saved = result;
    this.run = run;
  }
  async saveFailedRun(_taskId: string, run: import("../packages/ai/src/index").ContentAnalysisRunRecord): Promise<void> { this.failedRun = run; }
}

class SequenceProvider implements AiProvider {
  calls: AiGenerateRequest[] = [];
  constructor(readonly responses: readonly string[]) {}
  async generate(request: AiGenerateRequest) {
    this.calls.push(request);
    const content = this.responses[this.calls.length - 1] ?? "";
    await request.onEvent?.({ type: "reasoning_delta", delta: "拆解思考" });
    return { content, reasoning: "拆解思考" };
  }
  async transcribe(): Promise<string> { return ""; }
}

test("内容拆解发现无效证据引用时只修复一次并保存标准结果", async () => {
  const store = new MemoryContentStore();
  const provider = new SequenceProvider([
    JSON.stringify(resultWithReference("missing-segment")),
    JSON.stringify(resultWithReference("segment-0")),
  ]);
  const flow = new ContentAnalysisFlow({ provider, store });
  const result = await flow.run("task-1");
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(result.hook.evidenceRefs, ["segment-0"]);
  assert.equal(store.run?.reasoning, "拆解思考\n拆解思考");
});

test("内容拆解拒绝与真实任务不一致的source", async () => {
  const store = new MemoryContentStore();
  const invalid = resultWithReference("segment-0");
  invalid.source.taskId = "other-task";
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);
  const flow = new ContentAnalysisFlow({ provider, store });
  await assert.rejects(() => flow.run("task-1"), /修复/);
  assert.equal(store.failedRun?.status, "failed");
});
