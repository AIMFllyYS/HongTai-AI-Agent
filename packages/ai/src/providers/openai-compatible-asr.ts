import { TaskError } from "@hongtai/core";
import type {
  AiMediaSource,
  AiTranscriptionRequest,
  AiTransportRequest,
  AiTransportResponse,
  OpenAiCompatibleProviderConfig,
} from "../contracts/provider";

import type { ChatPayload } from "./openai-compatible-sse";

interface StepFunAsrPayload {
  readonly type?: unknown;
  readonly delta?: unknown;
  readonly text?: unknown;
  readonly message?: unknown;
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

export async function transcribeWithOpenAiCompatibleAsr(
  request: AiTranscriptionRequest,
  options: {
    readonly model: string;
    readonly asrTransport: OpenAiCompatibleProviderConfig["asrTransport"];
    readonly send: (
      path: string,
      transportRequest: Omit<AiTransportRequest, "version" | "path" | "timeoutMs">,
    ) => Promise<AiTransportResponse>;
    readonly readJson: (response: AiTransportResponse) => Promise<ChatPayload>;
  },
): Promise<string> {
  const source = transcriptionSource(request);
  if (options.asrTransport === "stepaudio-sse") {
    const format = stepFunAudioFormat(request);
    const response = await options.send("audio/asr/sse", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: {
        kind: "json",
        json: JSON.stringify({
          audio: {
            data: "transport://attachment/0",
            input: {
              transcription: { model: options.model, language: "zh", enable_itn: true },
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
    return readStepFunAsrEventStream(response);
  }
  if (options.asrTransport === "chat-input-audio") {
    const format = request.filename.split(".").pop()?.toLowerCase() || "wav";
    const response = await options.send("chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        kind: "json",
        json: JSON.stringify({
          model: options.model,
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
    const payload = await options.readJson(response);
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
    return content.trim();
  }
  const response = await options.send("audio/transcriptions", {
    method: "POST",
    headers: {},
    body: {
      kind: "multipart",
      fields: { model: options.model },
      file: {
        filename: request.filename,
        mimeType: request.mimeType,
        source,
      },
    },
    responseMode: "json",
  });
  const payload = await options.readJson(response) as ChatPayload & { text?: unknown };
  if (typeof payload.text !== "string") throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "AI转写响应缺少文本字段", action: "retry" });
  return payload.text.trim();
}

async function readStepFunAsrEventStream(response: AiTransportResponse): Promise<string> {
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
