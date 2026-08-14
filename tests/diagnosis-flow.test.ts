import assert from "node:assert/strict";
import test from "node:test";
import { TaskError, type StructuredGenerationProgressV1 } from "../packages/core/src/index";
import {
  DiagnosisFlow,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiProvider,
  type DiagnosisImageInput,
  type DiagnosisRepository,
  type DiagnosisReportV1,
  type DiagnosisSession,
} from "../packages/ai/src/index";

const validReport: DiagnosisReportV1 = {
  schemaVersion: "diagnosis-report.v1",
  mode: "tongue",
  promptVersion: "diagnosis-modular.v1",
  imageQuality: { usable: true, overallQuality: "good", limitations: [], retakeSuggestions: [] },
  summary: { headline: "舌象清晰可观察", keyPoints: ["舌体颜色较均匀"], narrative: "本结果仅提供可见状态观察参考。" },
  observations: [{ id: "obs-1", category: "tongue_body", region: "舌体", label: "颜色", description: "颜色较均匀", visibility: "clear", evidenceDescription: "舌体区域清晰" }],
  wellnessReferences: [{ title: "日常状态参考", basisObservationIds: ["obs-1"], statement: "可结合近期作息继续观察", certainty: "possible", notADiagnosis: true }],
  recommendations: [{ category: "monitoring", priority: "low", title: "持续观察", action: "保持相同光线定期记录", rationale: "便于比较变化", relatedObservationIds: ["obs-1"] }],
  safetyGuidance: { level: "none", reasons: [], recommendedAction: "如有持续不适请咨询专业人员" },
  followUpQuestions: ["最近作息是否规律？"],
  limitations: ["单张图片不能替代专业检查"],
  disclaimer: "本报告不是疾病诊断，也不提供患病概率。",
};

const validSingleResponse = {
  quality: "good" as const,
  observation: "舌体颜色较均匀，当前图片中的舌部区域清晰可见。",
  summary: "本次图片可用于日常可见状态记录，不代表疾病诊断。",
  wellnessReference: "传统观察中，这组可见特征可能作为日常状态记录线索；单张图片不能据此诊断。",
  advice: "保持相同光线和角度定期记录，并结合近期作息观察变化。",
  safety: "单张图片不能替代专业检查；如有持续不适，请咨询专业人员。",
  followUp: "最近作息是否规律？",
};

class MemoryRepository implements DiagnosisRepository {
  session: DiagnosisSession | undefined;
  image: { mimeType: string; data?: Uint8Array; uri?: string } | undefined;
  sessionImage: DiagnosisImageInput | undefined;
  report: DiagnosisReportV1 | undefined;
  messages: import("../packages/ai/src/index").AiMessage[] = [];
  summary = "";
  runs: import("../packages/ai/src/index").AiRunRecord[] = [];

  async createSession(mode: "tongue" | "face", image: { mimeType: string; data?: Uint8Array; uri?: string }): Promise<DiagnosisSession> {
    assert.ok((image.data?.length ?? 0) > 0 || Boolean(image.uri));
    this.image = image;
    this.sessionImage = image.data
      ? { mimeType: image.mimeType, data: image.data }
      : { mimeType: image.mimeType, uri: image.uri! };
    this.session = { id: "session-1", reportId: "report-1", mode, createdAt: "2026-08-05T00:00:00.000Z", image: { mimeType: image.mimeType } };
    return this.session;
  }
  async getSession(): Promise<DiagnosisSession | undefined> { return this.session; }
  async loadSessionImage(): Promise<DiagnosisImageInput | undefined> { return this.sessionImage; }
  async saveReport(_sessionId: string, report: DiagnosisReportV1): Promise<void> { this.report = report; }
  async getReport(): Promise<DiagnosisReportV1 | undefined> { return this.report; }
  async listMessages(): Promise<readonly import("../packages/ai/src/index").AiMessage[]> { return this.messages; }
  async appendMessages(_sessionId: string, messages: readonly import("../packages/ai/src/index").AiMessage[]): Promise<void> { this.messages.push(...messages); }
  async getContextSummary(): Promise<string> { return this.summary; }
  async saveContextSummary(_sessionId: string, summary: string): Promise<void> { this.summary = summary; }
  async saveRun(_sessionId: string, run: import("../packages/ai/src/index").AiRunRecord): Promise<void> { this.runs.push(run); }
}

test("诊察流程保留原生图片 URI，不将其转成 React Base64", async () => {
  const repository = new MemoryRepository();
  const provider = new SequenceProvider([JSON.stringify(validSingleResponse)], 3);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });

  await flow.analyze({
    mode: "tongue",
    image: { mimeType: "image/jpeg", uri: "content://media/external/images/72" },
  });

  assert.deepEqual(repository.image, { mimeType: "image/jpeg", uri: "content://media/external/images/72" });
  const content = provider.calls[0]?.messages[1]?.content;
  assert.equal(Array.isArray(content), true);
  assert.equal(Array.isArray(content) ? content.filter((part) => part.type === "image_uri" || part.type === "image_url").length : 0, 1);
  assert.deepEqual(Array.isArray(content) ? content.at(-1) : undefined, {
    type: "image_uri", uri: "content://media/external/images/72", mimeType: "image/jpeg",
  });
  assert.doesNotMatch(JSON.stringify(content), /base64/);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.model, "vision");
  assert.equal(provider.calls[0]?.maxOutputTokens, 2_048);
  assert.equal(provider.calls[0]?.jsonSchema?.name, "diagnosis_single_response_v1");
  assert.equal(repository.report?.promptVersion, "diagnosis-single-stream.v2");
});

test("已创建会话可复用私有图片运行正式报告，且会话只暴露安全 MIME 元数据", async () => {
  const repository = new MemoryRepository();
  repository.session = {
    id: "session-existing",
    reportId: "report-existing",
    mode: "tongue",
    createdAt: "2026-08-05T00:00:00.000Z",
    image: { mimeType: "image/png" },
  };
  repository.sessionImage = { mimeType: "image/png", uri: "content://app.private/diagnosis/session-existing/image" };
  const provider = new SequenceProvider(["不是JSON", JSON.stringify(validSingleResponse)]);
  const progress: StructuredGenerationProgressV1[] = [];
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000, onProgress: (event) => { progress.push(event); } });

  const result = await flow.runReport("session-existing");

  assert.equal(result.session.id, "session-existing");
  assert.equal(result.report.schemaVersion, "diagnosis-report.v1");
  assert.deepEqual(result.session.image, { mimeType: "image/png" });
  assert.equal("imagePath" in result.session, false);
  assert.doesNotMatch(JSON.stringify(result.session), /content:\/\/|normalized-image/);
  assert.equal(provider.calls.length, 2, "one whole-document repair is the only additional call");
  assert.deepEqual(provider.calls.map((call) => call.model), ["vision", "text"]);
  assert.deepEqual(provider.calls.map((call) => call.jsonSchema?.name), ["diagnosis_single_response_v1", "diagnosis_single_response_v1"]);
  assert.match(JSON.stringify(provider.calls[0]?.messages), /content:\/\/app\.private\/diagnosis\/session-existing\/image/u);
  assert.doesNotMatch(JSON.stringify(provider.calls[1]?.messages), /content:\/\/|image_uri|image_url|base64/u);
  assert.equal(repository.runs[0]?.kind, "diagnosis");
  assert.equal(repository.runs[0]?.reasoning, "");
  assert.equal(repository.runs[0]?.rawResponse, "");
  assert.deepEqual(repository.runs[0]?.promptVersions, ["diagnosis-single-stream.v2"]);
  assert.equal(progress.some((snapshot) => snapshot.modules.some((module) => module.status !== "succeeded" && module.result !== undefined)), false);
  assert.deepEqual(progress.at(-1)?.modules.map((module) => module.status), ["succeeded", "succeeded", "succeeded", "succeeded", "succeeded"]);
  assert.equal(progress.some((snapshot) => snapshot.thinking?.text === "调试思考"), true);
  assert.equal(progress.at(-1)?.thinking?.text, "调试思考调试思考");
  assert.doesNotMatch(JSON.stringify(repository.report), /调试思考/);
  assert.doesNotMatch(JSON.stringify(repository.runs), /调试思考|不是JSON|舌体颜色较均匀/u);
});

test("会话图片 MIME 与私有图片不一致时不调用视觉模型", async () => {
  const repository = new MemoryRepository();
  repository.session = {
    id: "session-mime-mismatch",
    reportId: "report-mime-mismatch",
    mode: "tongue",
    createdAt: "2026-08-05T00:00:00.000Z",
    image: { mimeType: "image/jpeg" },
  };
  repository.sessionImage = { mimeType: "image/png", uri: "content://app.private/diagnosis/session-mime-mismatch/image" };
  const provider = new SequenceProvider([JSON.stringify(validReport)]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });

  await assert.rejects(
    () => flow.runReport("session-mime-mismatch"),
    (error) => error instanceof TaskError && error.code === "IMAGE_INVALID",
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(repository.runs[0]?.status, "failed");
});

class SequenceProvider implements AiProvider {
  calls: AiGenerateRequest[] = [];
  constructor(readonly responses: readonly string[], readonly chunkWidth = Number.POSITIVE_INFINITY) {}
  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    this.calls.push(request);
    const content = this.responses[this.calls.length - 1] ?? "";
    await request.onEvent?.({ type: "reasoning_delta", delta: "调试思考" });
    const width = Number.isFinite(this.chunkWidth) ? this.chunkWidth : Math.max(1, content.length);
    for (let offset = 0; offset < content.length; offset += width) {
      await request.onEvent?.({ type: "content_delta", delta: content.slice(offset, offset + width) });
    }
    await request.onEvent?.({ type: "completed" });
    return { content, reasoning: "调试思考" };
  }
  async transcribe(): Promise<string> { return ""; }
}

class FailingProvider implements AiProvider {
  constructor(readonly code: "AI_PERMISSION_DENIED" | "AI_SERVER_ERROR") {}
  async generate(): Promise<AiGenerateResult> {
    throw new TaskError({ code: this.code, message: "供应商失败", action: "retry" });
  }
  async transcribe(): Promise<string> { return ""; }
}

test("舌象报告在首次JSON无效时只修复一次并保存标准结果", async () => {
  const repository = new MemoryRepository();
  const provider = new SequenceProvider(["不是JSON", JSON.stringify(validSingleResponse)]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const result = await flow.analyze({ mode: "tongue", image: { mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) } });
  assert.equal(result.report.summary.narrative, validSingleResponse.summary);
  assert.equal(result.report.wellnessReferences[0]?.certainty, "uncertain");
  assert.equal(result.report.wellnessReferences[0]?.notADiagnosis, true);
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]?.jsonSchema?.name, "diagnosis_single_response_v1");
  assert.match(String(provider.calls[0]?.messages[0]?.content), /"quality"/);
  assert.match(String(provider.calls[1]?.messages[0]?.content), /校正/u);
  assert.equal(repository.runs.length, 1);
  assert.equal(repository.runs[0]?.reasoning, "");
  assert.equal(repository.runs[0]?.rawResponse, "");
  assert.doesNotMatch(JSON.stringify(repository.report), /调试思考/);
});

test("后续对话保存文本消息信封且不把reasoning写入上下文", async () => {
  const repository = new MemoryRepository();
  repository.session = { id: "session-1", reportId: "report-1", mode: "tongue", createdAt: "2026-08-05T00:00:00.000Z", image: { mimeType: "image/jpeg" } };
  repository.report = validReport;
  const provider = new SequenceProvider(["建议结合规律作息继续观察。"]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const reply = await flow.chat("session-1", "平时要注意什么？");
  assert.equal(reply.content, "建议结合规律作息继续观察。");
  assert.deepEqual(repository.messages.map((message) => message.role), ["user", "assistant"]);
  assert.doesNotMatch(JSON.stringify(provider.calls[0]?.messages), /调试思考/);
  assert.equal(repository.runs[0]?.reasoning, "");
  assert.equal(repository.runs[0]?.rawResponse, "");
});

test("上下文超过窗口80%时摘要较早消息并保留最近六条", async () => {
  const repository = new MemoryRepository();
  repository.session = { id: "session-1", reportId: "report-1", mode: "tongue", createdAt: "2026-08-05T00:00:00.000Z", image: { mimeType: "image/jpeg" } };
  repository.report = validReport;
  repository.messages = Array.from({ length: 10 }, (_, index) => ({
    id: `message-${index}`,
    sessionId: "session-1",
    reportId: "report-1",
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `第${index}条很长的历史消息`.repeat(10),
    status: "completed" as const,
    createdAt: "2026-08-05T00:00:00.000Z",
  }));
  const provider = new SequenceProvider(["较早对话摘要", "最终回复"]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 100 });
  await flow.chat("session-1", "继续问");
  assert.equal(repository.summary, "较早对话摘要");
  assert.equal(provider.calls.length, 2);
  assert.match(JSON.stringify(provider.calls[1]?.messages), /较早对话摘要/);
  assert.doesNotMatch(JSON.stringify(provider.calls[1]?.messages), /第0条/);
});

test("图片不可用时Schema拒绝模型虚构可见观察项", async () => {
  const repository = new MemoryRepository();
  const invalid = JSON.stringify({ ...validSingleResponse, quality: "unusable", observation: "虚构观察", advice: "虚构建议" });
  const provider = new SequenceProvider([invalid, invalid]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  await assert.rejects(() => flow.analyze({ mode: "tongue", image: { mimeType: "image/jpeg", data: new Uint8Array([1]) } }), /修复/);
});

test("旧 diagnosis-initial.v1 报告仍保持可读取兼容性", async () => {
  const legacy = { ...validReport, promptVersion: "diagnosis-initial.v1" as const };
  const parsed = (await import("../packages/ai/src/index")).diagnosisReportSchema.safeParse(legacy);
  assert.equal(parsed.success, true);
});

test("文本模块权限失败不会误报为视觉能力不可用", async () => {
  const repository = new MemoryRepository();
  class TextPermissionProvider extends SequenceProvider {
    override async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
      if (this.calls.length === 0) return super.generate(request);
      this.calls.push(request);
      throw new TaskError({ code: "AI_PERMISSION_DENIED", message: "文本模型权限不足", action: "configure_ai" });
    }
  }
  const provider = new TextPermissionProvider(["不是JSON"]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  await assert.rejects(
    () => flow.analyze({ mode: "tongue", image: { mimeType: "image/jpeg", data: new Uint8Array([1]) } }),
    (error) => error instanceof TaskError && error.code === "AI_PERMISSION_DENIED",
  );
  assert.equal(provider.calls.length, 2);
});

test("视觉模型无权限时返回稳定的视觉能力错误", async () => {
  const repository = new MemoryRepository();
  const flow = new DiagnosisFlow({ provider: new FailingProvider("AI_PERMISSION_DENIED"), repository, contextWindowTokens: 32_000 });
  await assert.rejects(
    () => flow.analyze({ mode: "face", image: { mimeType: "image/jpeg", data: new Uint8Array([1]) } }),
    (error) => error instanceof TaskError && error.code === "AI_VISION_UNAVAILABLE",
  );
});

test("上下文摘要调用失败时返回稳定摘要错误且不追加消息", async () => {
  const repository = new MemoryRepository();
  repository.session = { id: "session-1", reportId: "report-1", mode: "tongue", createdAt: "2026-08-05T00:00:00.000Z", image: { mimeType: "image/jpeg" } };
  repository.report = validReport;
  repository.messages = Array.from({ length: 10 }, (_, index) => ({ id: `m-${index}`, sessionId: "session-1", reportId: "report-1", role: index % 2 ? "assistant" as const : "user" as const, content: "很长的历史".repeat(20), status: "completed" as const, createdAt: "2026-08-05T00:00:00.000Z" }));
  const originalCount = repository.messages.length;
  const flow = new DiagnosisFlow({ provider: new FailingProvider("AI_SERVER_ERROR"), repository, contextWindowTokens: 100 });
  await assert.rejects(() => flow.chat("session-1", "继续"), (error) => error instanceof TaskError && error.code === "AI_CONTEXT_SUMMARY_FAILED");
  assert.equal(repository.messages.length, originalCount);
});
