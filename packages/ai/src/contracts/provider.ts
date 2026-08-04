export type AiModelRole = "text" | "vision";
export type AiMessageRole = "system" | "user" | "assistant";

export type AiMessageContent = string | readonly (
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly imageUrl: string }
)[];

export interface AiRequestMessage {
  readonly role: AiMessageRole;
  readonly content: AiMessageContent;
}

export type AiStreamEvent =
  | { readonly type: "reasoning_delta"; readonly delta: string }
  | { readonly type: "content_delta"; readonly delta: string }
  | { readonly type: "usage"; readonly promptTokens?: number; readonly completionTokens?: number }
  | { readonly type: "completed" };

export interface AiGenerateRequest {
  readonly model: AiModelRole;
  readonly messages: readonly AiRequestMessage[];
  readonly output: "json" | "text";
  readonly onEvent?: (event: AiStreamEvent) => void | Promise<void>;
}

export interface AiGenerateResult {
  readonly content: string;
  readonly reasoning: string;
  readonly usage?: { readonly promptTokens?: number; readonly completionTokens?: number };
}

export interface AiTranscriptionRequest {
  readonly data: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
  transcribe(request: AiTranscriptionRequest): Promise<string>;
}

export interface OpenAiCompatibleProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: {
    readonly text: string;
    readonly vision: string;
    readonly asr?: string;
  };
  readonly supportsJsonObject: boolean;
  readonly asrTransport: "audio-transcriptions" | "chat-input-audio";
  readonly contextWindowTokens: number;
  readonly reasoningMode: "provider-default";
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}
