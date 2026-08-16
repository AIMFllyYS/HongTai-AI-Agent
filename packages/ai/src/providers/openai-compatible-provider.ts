import { TaskError } from "@hongtai/core";
import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiProvider,
  AiReasoningDialect,
  AiRequestMessage,
  AiTransport,
  AiTransportJsonAttachment,
  AiTransportRequest,
  AiTransportResponse,
  AiTranscriptionRequest,
  OpenAiCompatibleProviderConfig,
} from "../contracts/provider";

import { transcribeWithOpenAiCompatibleAsr } from "./openai-compatible-asr";
import { requestWithRetry, readTransportJson } from "./openai-compatible-retry";
import { readChatEventStream, reasoningValue, textValue, usageFromPayload } from "./openai-compatible-sse";

interface OpenAiProtocolConfig {
  readonly models: OpenAiCompatibleProviderConfig["models"];
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema?: boolean;
  readonly asrTransport: OpenAiCompatibleProviderConfig["asrTransport"];
  readonly contextWindowTokens: number;
  readonly reasoningDialect: OpenAiCompatibleProviderConfig["reasoningDialect"];
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}

function mapMessages(messages: readonly AiRequestMessage[]): {
  readonly messages: readonly unknown[];
  readonly attachments: readonly AiTransportJsonAttachment[];
} {
  const attachments: AiTransportJsonAttachment[] = [];
  return {
    messages: messages.map((message, messageIndex) => ({
      role: message.role,
      content: typeof message.content === "string"
        ? message.content
        : message.content.map((part, partIndex) => {
          if (part.type === "text") return part;
          if (part.type === "image_url") return { type: "image_url", image_url: { url: part.imageUrl } };
          const attachmentIndex = attachments.length;
          attachments.push({
            pointer: `/messages/${messageIndex}/content/${partIndex}/image_url/url`,
            source: { kind: "uri", uri: part.uri },
            mimeType: part.mimeType,
            materialization: "data-url-base64",
          });
          return { type: "image_url", image_url: { url: `transport://attachment/${attachmentIndex}` } };
        }),
    })),
    attachments,
  };
}

export function reasoningDialectForBaseUrl(baseUrl: string): AiReasoningDialect {
  try {
    const url = new URL(baseUrl);
    const normalized = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, "")}`;
    if (normalized === "https://api.xiaomimimo.com/v1") return "xiaomi-mimo";
    if (normalized === "https://api.stepfun.com/v1") return "stepfun";
  } catch {
    return "generic";
  }
  return "generic";
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly #config: OpenAiProtocolConfig;
  readonly #transport: AiTransport;

  constructor(config: OpenAiCompatibleProviderConfig) {
    if (!config.transport) {
      throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "AI传输适配器未配置", action: "configure_ai" });
    }
    this.#config = {
      models: config.models,
      supportsJsonObject: config.supportsJsonObject,
      supportsJsonSchema: config.supportsJsonSchema,
      asrTransport: config.asrTransport,
      contextWindowTokens: config.contextWindowTokens,
      reasoningDialect: config.reasoningDialect,
      retryDelaysMs: config.retryDelaysMs,
      timeoutMs: config.timeoutMs,
    };
    this.#transport = config.transport;
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
    const mappedMessages = mapMessages(request.messages);
    const reasoningBody = this.#config.reasoningDialect === "xiaomi-mimo"
      ? { thinking: { type: "enabled" } }
      : this.#config.reasoningDialect === "stepfun"
        ? { reasoning_format: "general" }
        : {};
    const tokenLimitBody = request.maxOutputTokens == null
      ? {}
      : this.#config.reasoningDialect === "xiaomi-mimo"
        ? { max_completion_tokens: request.maxOutputTokens }
        : { max_tokens: request.maxOutputTokens };
    const body = {
      model,
      messages: mappedMessages.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...reasoningBody,
      ...tokenLimitBody,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    const response = await this.#request("chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        kind: "json",
        json: JSON.stringify(body),
        ...(mappedMessages.attachments.length > 0 ? { attachments: mappedMessages.attachments } : {}),
      },
      responseMode: "stream",
    });
    if (response.body.kind !== "stream") {
      const payload = await readTransportJson(response);
      const message = payload.choices?.[0]?.message;
      const content = textValue(message?.content).trim();
      if (!content) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI响应缺少最终文本", action: "retry" });
      const reasoning = reasoningValue(message, this.#config.reasoningDialect);
      if (reasoning) await request.onEvent?.({ type: "reasoning_delta", delta: reasoning });
      await request.onEvent?.({ type: "content_delta", delta: content });
      const usage = usageFromPayload(payload);
      if (usage) await request.onEvent?.({ type: "usage", ...usage });
      await request.onEvent?.({ type: "completed" });
      return { content, reasoning, usage };
    }
    return readChatEventStream(response, this.#config.reasoningDialect, request.onEvent);
  }

  async transcribe(request: AiTranscriptionRequest): Promise<string> {
    const model = this.#config.models.asr;
    if (!model) throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "未配置ASR模型", action: "configure_ai" });
    return transcribeWithOpenAiCompatibleAsr(request, {
      model,
      asrTransport: this.#config.asrTransport,
      send: (path, transportRequest) => this.#request(path, transportRequest),
      readJson: readTransportJson,
    });
  }

  async #request(
    path: string,
    request: Omit<AiTransportRequest, "version" | "path" | "timeoutMs">,
  ): Promise<AiTransportResponse> {
    return requestWithRetry(this.#transport, path, request, {
      retryDelaysMs: this.#config.retryDelaysMs,
      timeoutMs: this.#config.timeoutMs,
    });
  }
}
