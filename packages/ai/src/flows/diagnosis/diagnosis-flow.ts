import { TaskError } from "@hongtai/core";
import type { AiGenerateResult, AiRequestMessage, AiStreamEvent } from "../../contracts/provider";
import type { AiMessage, DiagnosisFlowDependencies } from "../../contracts/diagnosis";
import { diagnosisConversationPrompt, diagnosisInitialPrompt, diagnosisRepairPrompt } from "../../prompts/diagnosis";
import { diagnosisReportSchema, type ObservationMode } from "../../schemas/diagnosis-report";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

function base64(data: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function messageId(): string {
  return crypto.randomUUID();
}

export class DiagnosisFlow {
  readonly #dependencies: DiagnosisFlowDependencies;

  constructor(dependencies: DiagnosisFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async analyze(input: { readonly mode: ObservationMode; readonly image: { readonly mimeType: string; readonly data: Uint8Array } }) {
    const session = await this.#dependencies.repository.createSession(input.mode, input.image);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let reasoning = "";
    let rawResponse = "";
    const onEvent = async (event: AiStreamEvent) => {
      if (event.type === "reasoning_delta") reasoning += `${reasoning ? "\n" : ""}${event.delta}`;
      await this.#dependencies.onEvent?.({ ...event, runId });
    };
    try {
      const initial = await this.#dependencies.provider.generate({
        model: "vision",
        output: "json",
        messages: [
          { role: "system", content: diagnosisInitialPrompt(input.mode) },
          { role: "user", content: [
            { type: "text", text: "请分析这张图片并返回完整报告。" },
            { type: "image_url", imageUrl: `data:${input.image.mimeType};base64,${base64(input.image.data)}` },
          ] },
        ],
        onEvent,
      });
      rawResponse = initial.content;
      let report;
      try {
        report = parseStructuredOutput(initial.content, diagnosisReportSchema);
      } catch (error) {
        if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
        const repaired = await this.#dependencies.provider.generate({
          model: "text",
          output: "json",
          messages: [{ role: "system", content: diagnosisRepairPrompt(initial.content, input.mode) }],
          onEvent,
        });
        rawResponse = `${initial.content}\n\n--- repaired ---\n${repaired.content}`;
        try {
          report = parseStructuredOutput(repaired.content, diagnosisReportSchema);
        } catch (repairError) {
          throw new TaskError({ code: "AI_FORMAT_REPAIR_FAILED", message: "AI报告格式修复后仍不符合Schema", action: "retry", cause: repairError });
        }
      }
      if (report.mode !== input.mode) {
        throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "AI报告类型与用户选择不一致", action: "retry" });
      }
      await this.#dependencies.repository.saveReport(session.id, report);
      await this.#dependencies.repository.saveRun(session.id, {
        id: runId, kind: "diagnosis", status: "succeeded", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning,
      });
      return { session, report };
    } catch (error) {
      const failure = error instanceof TaskError && error.code === "AI_PERMISSION_DENIED"
        ? new TaskError({ code: "AI_VISION_UNAVAILABLE", message: "当前AI连接没有可用的视觉模型能力", action: "configure_ai", cause: error })
        : error;
      await this.#dependencies.repository.saveRun(session.id, {
        id: runId, kind: "diagnosis", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning,
        errorCode: failure instanceof TaskError ? failure.code : "INTERNAL_UNKNOWN_ERROR",
      });
      throw failure;
    }
  }

  async chat(sessionId: string, question: string): Promise<AiMessage> {
    const session = await this.#dependencies.repository.getSession(sessionId);
    const report = await this.#dependencies.repository.getReport(sessionId);
    if (!session || !report) throw new TaskError({ code: "AI_SESSION_NOT_FOUND", message: "没有找到可继续对话的观察会话", action: "none" });
    if (!question.trim()) throw new TaskError({ code: "INPUT_EMPTY", message: "对话内容不能为空", action: "edit_input" });
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let reasoning = "";
    let rawResponse = "";
    try {
      const messages = await this.#conversationMessages(sessionId, report, question.trim());
      const result: AiGenerateResult = await this.#dependencies.provider.generate({
        model: "text",
        output: "text",
        messages,
        onEvent: async (event) => {
          if (event.type === "reasoning_delta") reasoning += `${reasoning ? "\n" : ""}${event.delta}`;
          await this.#dependencies.onEvent?.({ ...event, runId });
        },
      });
      rawResponse = result.content;
      const now = new Date().toISOString();
      const userMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "user", content: question.trim(), status: "completed", createdAt: now };
      const assistantMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "assistant", content: result.content, status: "completed", createdAt: new Date().toISOString() };
      await this.#dependencies.repository.appendMessages(sessionId, [userMessage, assistantMessage]);
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "succeeded", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning });
      return assistantMessage;
    } catch (error) {
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning, errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR" });
      throw error;
    }
  }

  async #conversationMessages(sessionId: string, report: import("../../schemas/diagnosis-report").DiagnosisReportV1, question: string): Promise<AiRequestMessage[]> {
    const history = await this.#dependencies.repository.listMessages(sessionId);
    let summary = await this.#dependencies.repository.getContextSummary(sessionId);
    const base: AiRequestMessage[] = [
      { role: "system", content: diagnosisConversationPrompt(report) },
      ...(summary ? [{ role: "system" as const, content: `较早对话摘要：${summary}` }] : []),
      ...history.map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
      { role: "user", content: question },
    ];
    const estimatedTokens = Math.ceil(JSON.stringify(base).length / 2);
    if (estimatedTokens > this.#dependencies.contextWindowTokens * 0.8 && history.length > 6) {
      const older = history.slice(0, -6);
      let result: AiGenerateResult;
      try {
        result = await this.#dependencies.provider.generate({
          model: "text",
          output: "text",
          messages: [
            { role: "system", content: "将以下较早对话压缩为忠实、简短的中文事实摘要，不加入新建议。" },
            { role: "user", content: JSON.stringify(older) },
          ],
        });
      } catch (error) {
        throw new TaskError({ code: "AI_CONTEXT_SUMMARY_FAILED", message: "较早对话摘要生成失败", action: "retry", cause: error });
      }
      summary = result.content;
      await this.#dependencies.repository.saveContextSummary(sessionId, summary);
      return [
        { role: "system", content: diagnosisConversationPrompt(report) },
        { role: "system", content: `较早对话摘要：${summary}` },
        ...history.slice(-6).map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
        { role: "user", content: question },
      ];
    }
    return base;
  }
}
