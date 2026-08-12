import assert from "node:assert/strict";
import test from "node:test";
import { TaskError, type StructuredGenerationProgressV1 } from "../packages/core/src/index";
import {
  ContentAnalysisFlow,
  contentAnalysisResultSchema,
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

class LocalVideoContentStore extends MemoryContentStore {
  override async loadInput(): Promise<ContentAnalysisInput> {
    return { ...input, platform: "local_upload" };
  }
}

class SequenceProvider implements AiProvider {
  calls: AiGenerateRequest[] = [];
  constructor(readonly responses: readonly string[], readonly chunked = false) {}
  async generate(request: AiGenerateRequest) {
    this.calls.push(request);
    const content = this.responses[this.calls.length - 1] ?? "";
    await request.onEvent?.({ type: "reasoning_delta", delta: "拆解思考" });
    if (this.chunked) {
      const widths = [1, 3, 2, 7, 4, 11];
      let offset = 0;
      let widthIndex = 0;
      while (offset < content.length) {
        const width = widths[widthIndex % widths.length]!;
        await request.onEvent?.({ type: "content_delta", delta: content.slice(offset, offset + width) });
        offset += width;
        widthIndex += 1;
      }
      await request.onEvent?.({ type: "completed" });
    }
    return { content, reasoning: "拆解思考" };
  }
  async transcribe(): Promise<string> { return ""; }
}

function moduleResponses(reference = "segment-0"): readonly string[] {
  const result = resultWithReference(reference);
  return [
    JSON.stringify({ overview: result.overview }),
    JSON.stringify({ hook: result.hook, painPoints: result.painPoints, emotionalDrivers: result.emotionalDrivers }),
    JSON.stringify({ structure: result.structure, coreClaims: result.coreClaims }),
    JSON.stringify({ style: result.style, reusableTemplate: result.reusableTemplate }),
    JSON.stringify({ risks: result.risks }),
  ];
}

test("内容拆解固定五个模块并由本地注入真实source", async () => {
  const store = new MemoryContentStore();
  const provider = new SequenceProvider(moduleResponses());
  const progress: StructuredGenerationProgressV1[] = [];
  const flow = new ContentAnalysisFlow({ provider, store, onProgress: (event) => { progress.push(event); } });
  const result = await flow.run("task-1");
  assert.equal(provider.calls.length, 5);
  assert.deepEqual(provider.calls.map((call) => call.model), ["text", "text", "text", "text", "text"]);
  assert.deepEqual(provider.calls.map((call) => call.jsonSchema?.name), [
    "content_analysis_overview_v1",
    "content_analysis_hook_drivers_v1",
    "content_analysis_structure_claims_v1",
    "content_analysis_style_template_v1",
    "content_analysis_risks_boundaries_v1",
  ]);
  for (const call of provider.calls) {
    assert.doesNotMatch(String(call.messages[0]?.content), /测试内容|测试作者/);
    assert.match(String(call.messages[0]?.content), /segment-0/);
  }
  assert.deepEqual(result.hook.evidenceRefs, ["segment-0"]);
  assert.deepEqual(result.source, { taskId: "task-1", platform: "bilibili", contentType: "video", sourceKind: "asr" });
  assert.equal(store.run?.reasoning, Array.from({ length: 5 }, () => "拆解思考").join("\n"));
  assert.equal(store.run?.promptVersions.length, 5);
  assert.equal(new Set(store.run?.promptVersions).size, 5);
  const succeeded = progress.flatMap((snapshot) => snapshot.modules.filter((module) => module.status === "succeeded"));
  assert.ok(succeeded.length > 0);
  assert.equal(progress.some((snapshot) => snapshot.modules.some((module) => module.status !== "succeeded" && module.result !== undefined)), false);
});

test("任意JSON碎片边界不会把未校验字段暴露为模块结果", async () => {
  const store = new MemoryContentStore();
  const responses = [...moduleResponses()];
  const overview = JSON.parse(responses[0]!) as { overview: { summary: string } };
  overview.overview.summary = "他说\"先看证据，再谈方法\"";
  responses[0] = JSON.stringify(overview);
  const provider = new SequenceProvider(responses, true);
  let latest: StructuredGenerationProgressV1 | undefined;
  let contentDeltaCount = 0;

  const result = await new ContentAnalysisFlow({
    provider,
    store,
    onProgress: (progress) => { latest = progress; },
    onEvent: (event) => {
      if (event.type !== "content_delta") return;
      contentDeltaCount += 1;
      const active = latest?.modules.find((module) => module.status === "running" || module.status === "repairing");
      assert.ok(active, "a streamed transport delta must belong to one active module");
      assert.equal(active.result, undefined, "partial JSON is not a validated module result");
    },
  }).run("task-1");

  assert.ok(contentDeltaCount > 50, "the fixture must cross many JSON token and field-name boundaries");
  assert.equal(result.overview.summary, "他说\"先看证据，再谈方法\"");
  assert.equal(latest?.phase, "saving");
  assert.equal(latest?.modules.every((module) => module.status === "succeeded" && module.result !== undefined), true);
});

test("内容拆解只修复当前失败模块一次且不会继续调用后续模块", async () => {
  const store = new MemoryContentStore();
  const responses = [...moduleResponses()];
  const invalid = resultWithReference("missing-segment");
  responses.splice(2, 3,
    JSON.stringify({ structure: invalid.structure, coreClaims: invalid.coreClaims }),
    JSON.stringify({ structure: invalid.structure, coreClaims: invalid.coreClaims }),
  );
  const provider = new SequenceProvider(responses);
  const flow = new ContentAnalysisFlow({ provider, store });
  await assert.rejects(
    () => flow.run("task-1"),
    (error) => error instanceof TaskError && error.code === "AI_FORMAT_REPAIR_FAILED",
  );
  assert.equal(provider.calls.length, 4, "modules after structure-claims must remain pending");
  assert.equal(provider.calls[2]?.jsonSchema?.name, "content_analysis_structure_claims_v1");
  assert.equal(provider.calls[3]?.jsonSchema?.name, "content_analysis_structure_claims_v1");
  assert.equal(store.failedRun?.status, "failed");
  assert.equal(store.saved, undefined);
});

test("证据不足时允许空受众、空结构和空模板步骤而不诱导虚构", () => {
  const insufficient = resultWithReference("segment-0");
  insufficient.overview.targetAudiences = [];
  insufficient.structure = [];
  insufficient.reusableTemplate.steps = [];
  assert.equal(contentAnalysisResultSchema.safeParse(insufficient).success, true);
});

test("本地上传视频使用显式来源并通过正式拆解语义校验", async () => {
  const store = new LocalVideoContentStore();
  const provider = new SequenceProvider(moduleResponses());

  const result = await new ContentAnalysisFlow({ provider, store }).run("task-1");

  assert.equal(result.source.platform, "local_upload");
  assert.equal(contentAnalysisResultSchema.safeParse(result).success, true);
  assert.equal(provider.calls.length, 5);
});
