import { TaskError } from "@hongtai/core";
import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiMediaSource,
  AiProvider,
  AiRequestMessage,
  AiStreamEvent,
  AiTransport,
  AiTransportJsonAttachment,
  AiTransportRequest,
  AiTransportResponse,
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

interface StepFunAsrPayload {
  readonly type?: unknown;
  readonly delta?: unknown;
  readonly text?: unknown;
  readonly message?: unknown;
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

interface OpenAiProtocolConfig {
  readonly models: OpenAiCompatibleProviderConfig["models"];
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema?: boolean;
  readonly asrTransport: OpenAiCompatibleProviderConfig["asrTransport"];
  readonly contextWindowTokens: number;
  readonly reasoningMode: OpenAiCompatibleProviderConfig["reasoningMode"];
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}

function transcriptionSource(request: AiTranscriptionRequest): AiMediaSource {
  return request.data
    ? { kind: "base64", base64: encodeBase64(request.data) }
    : { kind: "uri", uri: request.uri };
}

function stepFunAudioFormat(request: AiTranscriptionRequest): "wav" | "mp3" | "ogg" | "pcm" {
  const mimeType = request.mimeType.toLowerCase();
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  if (mimeType === "audio/mpeg" || mimeType === "audio/mp3") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/pcm" || mimeType === "audio/l16") return "pcm";
  throw new TaskError({ code: "AI_SETTINGS_INVALID", message: "StepFun ASR 仅支持 WAV、MP3、OGG 或 PCM 音频", action: "configure_ai" });
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
      reasoningMode: config.reasoningMode,
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
    const body = {
      model,
      messages: mappedMessages.messages,
      stream: true,
      stream_options: { include_usage: true },
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
    const source = transcriptionSource(request);
    if (this.#config.asrTransport === "stepaudio-sse") {
      const format = stepFunAudioFormat(request);
      const response = await this.#request("audio/asr/sse", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: {
          kind: "json",
          json: JSON.stringify({
            audio: {
              data: "transport://attachment/0",
              input: {
                transcription: { model, language: "zh", enable_itn: true },
                format: { type: format },
              },
            },
          }),
          attachments: [{
            pointer: "/audio/data",
            source,
            mimeType: request.mimeType,
            materialization: "raw-base64",
          }],
        },
        responseMode: "stream",
      });
      return this.#readStepFunAsrEventStream(response);
    }
    if (this.#config.asrTransport === "chat-input-audio") {
      const format = request.filename.split(".").pop()?.toLowerCase() || "wav";
      const response = await this.#request("chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          kind: "json",
          json: JSON.stringify({
            model,
            messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "transport://attachment/0", format } }] }],
            asr_options: { language: "auto" },
          }),
          attachments: [{
            pointer: "/messages/0/content/0/input_audio/data",
            source,
            mimeType: request.mimeType,
            materialization: "raw-base64",
          }],
        },
        responseMode: "json",
      });
      const payload = await this.#readJson(response);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
      return content.trim();
    }
    const response = await this.#request("audio/transcriptions", {
      method: "POST",
      headers: {},
      body: {
        kind: "multipart",
        fields: { model },
        file: {
          filename: request.filename,
          mimeType: request.mimeType,
          source,
        },
      },
      responseMode: "json",
    });
    const payload = await this.#readJson(response) as ChatPayload & { text?: unknown };
    if (typeof payload.text !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
    return payload.text.trim();
  }

  async #readStepFunAsrEventStream(response: AiTransportResponse): Promise<string> {
    if (response.body.kind !== "stream") {
      throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "StepFun ASR 流式响应没有正文", action: "retry" });
    }
    let buffer = "";
    let deltaText = "";
    let completedText = "";
    const consumeBlocks = (source: string): string => {
      const blocks = source.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        let payload: StepFunAsrPayload;
        try {
          payload = JSON.parse(data) as StepFunAsrPayload;
        } catch (error) {
          throw new TaskError({ code: "AI_SERVER_ERROR", message: "StepFun ASR 返回了无效的流式 JSON", retryable: true, action: "retry", cause: error });
        }
        if (payload.type === "error") {
          throw new TaskError({ code: "AI_SERVER_ERROR", message: "StepFun ASR 请求没有完成", retryable: true, action: "retry" });
        }
        if (payload.type === "transcript.text.delta" && typeof payload.delta === "string") deltaText += payload.delta;
        if (payload.type === "transcript.text.done" && typeof payload.text === "string") completedText = payload.text;
      }
      return buffer;
    };
    for await (const chunk of response.body.chunks) consumeBlocks(buffer + chunk);
    if (buffer.trim()) consumeBlocks(`${buffer}\n\n`);
    const text = (completedText || deltaText).trim();
    if (!text) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "StepFun ASR 响应缺少转写文本", action: "retry" });
    return text;
  }

  async #readEventStream(
    response: AiTransportResponse,
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

  async #request(
    path: string,
    request: Omit<AiTransportRequest, "version" | "path" | "timeoutMs">,
  ): Promise<AiTransportResponse> {
    const delays = this.#config.retryDelaysMs ?? [0, 1_000, 3_000];
    let lastError: TaskError | undefined;
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await this.#transport.request({
          version: "ai-transport.v1",
          path,
          ...request,
          timeoutMs: this.#config.timeoutMs ?? 90_000,
        });
        if (response.status >= 200 && response.status < 300) return response;
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

  async #readJson(response: AiTransportResponse): Promise<ChatPayload> {
    const text = (await this.#responseText(response)).slice(0, 65_536);
    try {
      return (text ? JSON.parse(text) : {}) as ChatPayload;
    } catch (error) {
      throw new TaskError({ code: "AI_SERVER_ERROR", message: "AI返回了无效JSON", retryable: true, action: "retry", cause: error });
    }
  }

  async #responseText(response: AiTransportResponse): Promise<string> {
    if (response.body.kind === "json") return response.body.text;
    let text = "";
    for await (const chunk of response.body.chunks) {
      text += chunk;
      if (text.length >= 65_536) return text;
    }
    return text;
  }
}
