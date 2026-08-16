import { TaskError } from "@hongtai/core";
import type { AiGenerateResult, AiRequestMessage } from "../../contracts/provider";
import type { DiagnosisFlowDependencies } from "../../contracts/diagnosis";
import { diagnosisConversationPrompt } from "../../prompts/diagnosis-conversation";
import { diagnosisContextSummarySchema } from "../../schemas/diagnosis-context-summary";
import type { DiagnosisReportV1 } from "../../schemas/diagnosis-report";
import { estimateWeightedTokens } from "./estimate-context-tokens";

function parsedContextSummary(value: string, required: boolean): string {
  const parsed = diagnosisContextSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!required && !value.trim()) return "";
  throw new TaskError({ code: "AI_CONTEXT_SUMMARY_FAILED", message: "较早对话摘要未通过校验", action: "retry" });
}

export async function conversationMessagesForFollowUp(
  dependencies: Pick<DiagnosisFlowDependencies, "provider" | "repository" | "contextWindowTokens">,
  sessionId: string,
  report: DiagnosisReportV1,
  question: string,
): Promise<AiRequestMessage[]> {
  const history = await dependencies.repository.listMessages(sessionId);
  const summary = parsedContextSummary(await dependencies.repository.getContextSummary(sessionId), false);
  const base: AiRequestMessage[] = [
    { role: "system", content: diagnosisConversationPrompt(report) },
    ...(summary ? [{ role: "system" as const, content: `较早对话摘要：${summary}` }] : []),
    ...history.map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
    { role: "user", content: question },
  ];
  const estimatedTokens = estimateWeightedTokens(JSON.stringify(base));
  if (estimatedTokens > dependencies.contextWindowTokens * 0.8 && history.length > 6) {
    const older = history.slice(0, -6);
    let result: AiGenerateResult;
    try {
      result = await dependencies.provider.generate({
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
    const compressed = parsedContextSummary(result.content, true);
    await dependencies.repository.saveContextSummary(sessionId, compressed);
    return [
      { role: "system", content: diagnosisConversationPrompt(report) },
      { role: "system", content: `较早对话摘要：${compressed}` },
      ...history.slice(-6).map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
      { role: "user", content: question },
    ];
  }
  return base;
}
