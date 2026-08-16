import { TaskError } from "@hongtai/core";
import type { AiGenerateResult, AiReasoningDialect, AiStreamEvent, AiTransportResponse } from "../contracts/provider";

export interface ChatPayload {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown; readonly reasoning_content?: unknown; readonly reasoning?: unknown };
    readonly delta?: { readonly content?: unknown; readonly reasoning_content?: unknown; readonly reasoning?: unknown };
  }[];
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
  readonly error?: { readonly code?: unknown; readonly type?: unknown; readonly message?: unknown };
}

export function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function reasoningValue(
  value: { readonly reasoning_content?: unknown; readonly reasoning?: unknown } | undefined,
  dialect: AiReasoningDialect,
): string {
  if (dialect === "stepfun") return textValue(value?.reasoning) || textValue(value?.reasoning_content);
  return textValue(value?.reasoning_content) || textValue(value?.reasoning);
}

export function usageFromPayload(payload: ChatPayload): AiGenerateResult["usage"] {
  const promptTokens = typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : undefined;
  const completionTokens = typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : undefined;
  return promptTokens == null && completionTokens == null ? undefined : { promptTokens, completionTokens };
}

export async function readChatEventStream(
  response: AiTransportResponse,
  dialect: AiReasoningDialect,
  onEvent?: (event: AiStreamEvent) => void | Promise<void>,
): Promise<AiGenerateResult> {
  if (!response.body) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI流式响应没有正文", action: "retry" });
  if (response.body.kind !== "stream") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI流式响应没有正文", action: "retry" });
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage: AiGenerateResult["usage"];
  for await (const chunk of response.body.chunks) {
    buffer += chunk;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      let payload: ChatPayload;
      try {
        payload = JSON.parse(data) as ChatPayload;
      } catch (error) {
        throw new TaskError({ code: "AI_SERVER_ERROR", message: "AI返回了无效的流式JSON", retryable: true, action: "retry", cause: error });
      }
      const delta = payload.choices?.[0]?.delta;
      const reasoningDelta = reasoningValue(delta, dialect);
      const contentDelta = textValue(delta?.content);
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        await onEvent?.({ type: "reasoning_delta", delta: reasoningDelta });
      }
      if (contentDelta) {
        content += contentDelta;
        await onEvent?.({ type: "content_delta", delta: contentDelta });
      }
      const nextUsage = usageFromPayload(payload);
      if (nextUsage) {
        usage = nextUsage;
        await onEvent?.({ type: "usage", ...nextUsage });
      }
    }
  }
  if (!content.trim()) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI响应缺少最终文本", action: "retry" });
  await onEvent?.({ type: "completed" });
  return { content: content.trim(), reasoning, usage };
}
