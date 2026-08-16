import { TaskError } from "@hongtai/core";
import type { AiTransport, AiTransportRequest, AiTransportResponse } from "../contracts/provider";

import { type ChatPayload, textValue } from "./openai-compatible-sse";

export async function requestWithRetry(
  transport: AiTransport,
  path: string,
  request: Omit<AiTransportRequest, "version" | "path" | "timeoutMs">,
  options: {
    readonly retryDelaysMs?: readonly number[];
    readonly timeoutMs?: number;
  },
): Promise<AiTransportResponse> {
  const delays = options.retryDelaysMs ?? [0, 1_000, 3_000];
  let lastError: TaskError | undefined;
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await transport.request({
        version: "ai-transport.v1",
        path,
        ...request,
        timeoutMs: options.timeoutMs ?? 90_000,
      });
      if (response.status >= 200 && response.status < 300) return response;
      const payload = await readTransportJson(response).catch(() => ({} as ChatPayload));
      const providerText = `${textValue(payload.error?.code)} ${textValue(payload.error?.type)} ${textValue(payload.error?.message)}`;
      const details = { httpStatus: response.status };
      if (response.status === 401) throw new TaskError({ code: "AI_AUTH_INVALID", message: "AI API Key无效", action: "configure_ai", details });
      if (response.status === 403 || response.status === 404) throw new TaskError({ code: "AI_PERMISSION_DENIED", message: "AI连接没有对应模型或接口权限", action: "configure_ai", details });
      if (response.status === 429 && /quota|balance|credit|insufficient|额度|余额/i.test(providerText)) {
        throw new TaskError({ code: "AI_QUOTA_EXHAUSTED", message: "AI账户额度或余额不足", action: "configure_ai", details });
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new TaskError({
          code: response.status === 429 ? "AI_RATE_LIMITED" : "AI_SERVER_ERROR",
          message: response.status === 429 ? "AI请求过于频繁，请稍后重试" : "AI服务暂时不可用",
          retryable: true,
          action: "wait_and_retry",
          details,
        });
        continue;
      }
      throw new TaskError({ code: "AI_SERVER_ERROR", message: `AI请求被拒绝：HTTP ${response.status}`, action: "configure_ai", details });
    } catch (error) {
      if (error instanceof TaskError) {
        if (!error.retryable) throw error;
        lastError = error;
        continue;
      }
      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      lastError = new TaskError({
        code: timedOut ? "AI_TIMEOUT" : "AI_NETWORK_FAILED",
        message: timedOut ? "AI请求超时" : "无法连接AI服务",
        retryable: true,
        action: timedOut ? "retry" : "check_network",
        cause: error,
      });
    }
  }
  throw lastError ?? new TaskError({ code: "AI_NETWORK_FAILED", message: "AI请求失败", action: "retry" });
}

export async function readTransportJson(response: AiTransportResponse): Promise<ChatPayload> {
  const text = (await readTransportText(response)).slice(0, 65_536);
  try {
    return (text ? JSON.parse(text) : {}) as ChatPayload;
  } catch (error) {
    throw new TaskError({ code: "AI_SERVER_ERROR", message: "AI返回了无效JSON", retryable: true, action: "retry", cause: error });
  }
}

async function readTransportText(response: AiTransportResponse): Promise<string> {
  if (response.body.kind === "json") return response.body.text;
  let text = "";
  for await (const chunk of response.body.chunks) {
    text += chunk;
    if (text.length >= 65_536) return text;
  }
  return text;
}
