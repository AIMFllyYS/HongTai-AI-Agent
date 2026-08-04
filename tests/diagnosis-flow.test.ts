import assert from "node:assert/strict";
import test from "node:test";
import {
  DiagnosisFlow,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiProvider,
  type DiagnosisRepository,
  type DiagnosisReportV1,
  type DiagnosisSession,
} from "../packages/ai/src/index";

const validReport: DiagnosisReportV1 = {
  schemaVersion: "diagnosis-report.v1",
  mode: "tongue",
  promptVersion: "diagnosis-initial.v1",
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

class MemoryRepository implements DiagnosisRepository {
  session: DiagnosisSession | undefined;
  report: DiagnosisReportV1 | undefined;
  messages: import("../packages/ai/src/index").AiMessage[] = [];
  summary = "";
  runs: import("../packages/ai/src/index").AiRunRecord[] = [];

  async createSession(mode: "tongue" | "face", image: { mimeType: string; data: Uint8Array }): Promise<DiagnosisSession> {
    assert.ok(image.data.length > 0);
    this.session = { id: "session-1", reportId: "report-1", mode, createdAt: "2026-08-05T00:00:00.000Z", imagePath: "source/normalized-image.jpg" };
    return this.session;
  }
  async getSession(): Promise<DiagnosisSession | undefined> { return this.session; }
  async saveReport(_sessionId: string, report: DiagnosisReportV1): Promise<void> { this.report = report; }
  async getReport(): Promise<DiagnosisReportV1 | undefined> { return this.report; }
  async listMessages(): Promise<readonly import("../packages/ai/src/index").AiMessage[]> { return this.messages; }
  async appendMessages(_sessionId: string, messages: readonly import("../packages/ai/src/index").AiMessage[]): Promise<void> { this.messages.push(...messages); }
  async getContextSummary(): Promise<string> { return this.summary; }
  async saveContextSummary(_sessionId: string, summary: string): Promise<void> { this.summary = summary; }
  async saveRun(_sessionId: string, run: import("../packages/ai/src/index").AiRunRecord): Promise<void> { this.runs.push(run); }
}

class SequenceProvider implements AiProvider {
  calls: AiGenerateRequest[] = [];
  constructor(readonly responses: readonly string[]) {}
  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    this.calls.push(request);
    const content = this.responses[this.calls.length - 1] ?? "";
    await request.onEvent?.({ type: "reasoning_delta", delta: "调试思考" });
    await request.onEvent?.({ type: "content_delta", delta: content });
    await request.onEvent?.({ type: "completed" });
    return { content, reasoning: "调试思考" };
  }
  async transcribe(): Promise<string> { return ""; }
}

test("舌象报告在首次JSON无效时只修复一次并保存标准结果", async () => {
  const repository = new MemoryRepository();
  const provider = new SequenceProvider(["不是JSON", JSON.stringify(validReport)]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const result = await flow.analyze({ mode: "tongue", image: { mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) } });
  assert.equal(result.report.summary.headline, validReport.summary.headline);
  assert.equal(provider.calls.length, 2);
  assert.equal(repository.runs.length, 1);
  assert.equal(repository.runs[0]?.reasoning, "调试思考\n调试思考");
  assert.doesNotMatch(JSON.stringify(repository.report), /调试思考/);
});

test("后续对话保存文本消息信封且不把reasoning写入上下文", async () => {
  const repository = new MemoryRepository();
  repository.session = { id: "session-1", reportId: "report-1", mode: "tongue", createdAt: "2026-08-05T00:00:00.000Z", imagePath: "source/normalized-image.jpg" };
  repository.report = validReport;
  const provider = new SequenceProvider(["建议结合规律作息继续观察。"]);
  const flow = new DiagnosisFlow({ provider, repository, contextWindowTokens: 32_000 });
  const reply = await flow.chat("session-1", "平时要注意什么？");
  assert.equal(reply.content, "建议结合规律作息继续观察。");
  assert.deepEqual(repository.messages.map((message) => message.role), ["user", "assistant"]);
  assert.doesNotMatch(JSON.stringify(provider.calls[0]?.messages), /调试思考/);
});

test("上下文超过窗口80%时摘要较早消息并保留最近六条", async () => {
  const repository = new MemoryRepository();
  repository.session = { id: "session-1", reportId: "report-1", mode: "tongue", createdAt: "2026-08-05T00:00:00.000Z", imagePath: "source/normalized-image.jpg" };
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
