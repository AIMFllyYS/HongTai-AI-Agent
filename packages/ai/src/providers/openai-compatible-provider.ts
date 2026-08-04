import { TaskError } from "@hongtai/core";
import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiProvider,
  AiRequestMessage,
  AiStreamEvent,
  AiTranscriptionRequest,
  OpenAiCompatibleProviderConfig,
} from "../contracts/provider";

interface ChatPayload {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown; readonly reasoning_content?: unknown; readonly reasoning?: unknown };
    readonly delta?: { readonly content?: unknown; readonly reasoning_content?: unknown; readonly reasoning?: unknown };
  }[];
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
  readonly error?: { readonly code?: unknown; readonly type?: unknown; readonly message?: unknown };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function mapMessages(messages: readonly AiRequestMessage[]): unknown[] {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.type === "text"
        ? part
        : { type: "image_url", image_url: { url: part.imageUrl } }),
  }));
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly #config: OpenAiCompatibleProviderConfig;

  constructor(config: OpenAiCompatibleProviderConfig) {
    if (!config.baseUrl.trim() || !config.apiKey.trim()) {
      throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "AI连接缺少Base URL或API Key", action: "configure_ai" });
    }
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:") {
      throw new TaskError({ code: "AI_NETWORK_FAILED", message: "AI Base URL必须使用HTTPS", action: "configure_ai" });
    }
    this.#config = config;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const model = request.model === "vision" ? this.#config.models.vision : this.#config.models.text;
    if (!model?.trim()) {
      throw new TaskError({ code: "AI_NOT_CONFIGURED", message: `未配置${request.model === "vision" ? "视觉" : "文本"}模型`, action: "configure_ai" });
    }
    const responseFormat = request.output === "json" && request.jsonSchema && this.#config.supportsJsonSchema
      ? { type: "json_schema", json_schema: request.jsonSchema }
      : request.output === "json" && this.#config.supportsJsonObject
        ? { type: "json_object" }
        : undefined;
    const body = {
      model,
      messages: mapMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    const response = await this.#request("chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const payload = await this.#readJson(response);
      const message = payload.choices?.[0]?.message;
      const content = textValue(message?.content).trim();
      if (!content) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI响应缺少最终文本", action: "retry" });
      const reasoning = textValue(message?.reasoning_content) || textValue(message?.reasoning);
      if (reasoning) await request.onEvent?.({ type: "reasoning_delta", delta: reasoning });
      await request.onEvent?.({ type: "content_delta", delta: content });
      const usage = this.#usage(payload);
      if (usage) await request.onEvent?.({ type: "usage", ...usage });
      await request.onEvent?.({ type: "completed" });
      return { content, reasoning, usage };
    }
    return this.#readEventStream(response, request.onEvent);
  }

  async transcribe(request: AiTranscriptionRequest): Promise<string> {
    const model = this.#config.models.asr;
    if (!model) throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "未配置ASR模型", action: "configure_ai" });
    if (this.#config.asrTransport === "chat-input-audio") {
      const format = request.filename.split(".").pop()?.toLowerCase() || "wav";
      const base64 = encodeBase64(request.data);
      const response = await this.#request("chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:${request.mimeType};base64,${base64}`, format } }] }],
          asr_options: { language: "auto" },
        }),
      });
      const payload = await this.#readJson(response);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
      return content.trim();
    }
    const form = new FormData();
    form.set("model", model);
    const bytes = new Uint8Array(request.data.byteLength);
    bytes.set(request.data);
    form.set("file", new File([bytes.buffer], request.filename, { type: request.mimeType }));
    const response = await this.#request("audio/transcriptions", { method: "POST", body: form });
    const payload = await this.#readJson(response) as ChatPayload & { text?: unknown };
    if (typeof payload.text !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
    return payload.text.trim();
  }

  async #readEventStream(
    response: Response,
    onEvent?: (event: AiStreamEvent) => void | Promise<void>,
  ): Promise<AiGenerateResult> {
    if (!response.body) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI流式响应没有正文", action: "retry" });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let usage: AiGenerateResult["usage"];
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.value ?? "";
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
        const reasoningDelta = textValue(delta?.reasoning_content) || textValue(delta?.reasoning);
        const contentDelta = textValue(delta?.content);
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          await onEvent?.({ type: "reasoning_delta", delta: reasoningDelta });
        }
        if (contentDelta) {
          content += contentDelta;
          await onEvent?.({ type: "content_delta", delta: contentDelta });
        }
        const nextUsage = this.#usage(payload);
        if (nextUsage) {
          usage = nextUsage;
          await onEvent?.({ type: "usage", ...nextUsage });
        }
      }
      if (chunk.done) break;
    }
    if (!content.trim()) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI响应缺少最终文本", action: "retry" });
    await onEvent?.({ type: "completed" });
    return { content: content.trim(), reasoning, usage };
  }

  #usage(payload: ChatPayload): AiGenerateResult["usage"] {
    const promptTokens = typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : undefined;
    const completionTokens = typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : undefined;
    return promptTokens == null && completionTokens == null ? undefined : { promptTokens, completionTokens };
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.#config.baseUrl.replace(/\/+$/, "")}/${path}`;
    const delays = this.#config.retryDelaysMs ?? [0, 1_000, 3_000];
    let lastError: TaskError | undefined;
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(url, {
          ...init,
          headers: { Authorization: `Bearer ${this.#config.apiKey}`, ...init.headers },
          signal: AbortSignal.timeout(this.#config.timeoutMs ?? 90_000),
        });
        if (response.ok) return response;
        const payload = await this.#readJson(response).catch(() => ({} as ChatPayload));
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

  async #readJson(response: Response): Promise<ChatPayload> {
    const text = (await response.text()).slice(0, 65_536);
    try {
      return (text ? JSON.parse(text) : {}) as ChatPayload;
    } catch (error) {
      throw new TaskError({ code: "AI_SERVER_ERROR", message: "AI返回了无效JSON", retryable: true, action: "retry", cause: error });
    }
  }
}
