export type AiModelRole = "text" | "vision";
export type AiMessageRole = "system" | "user" | "assistant";

export type AiMessageContent = string | readonly (
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly imageUrl: string }
  | { readonly type: "image_uri"; readonly uri: string; readonly mimeType: string }
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
  readonly jsonSchema?: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
    readonly strict?: boolean;
  };
  readonly onEvent?: (event: AiStreamEvent) => void | Promise<void>;
}

export interface AiGenerateResult {
  readonly content: string;
  readonly reasoning: string;
  readonly usage?: { readonly promptTokens?: number; readonly completionTokens?: number };
}

export type AiMediaSource =
  | { readonly kind: "base64"; readonly base64: string }
  | { readonly kind: "uri"; readonly uri: string };

/**
 * Bridge-safe request body for an OpenAI-compatible transport. JSON and media
 * sources are represented as strings so a native bridge never needs to accept
 * a React-owned Blob or API Key.
 */
export type AiTransportBody =
  | { readonly kind: "json"; readonly json: string; readonly attachments?: readonly AiTransportJsonAttachment[] }
  | { readonly kind: "multipart"; readonly fields: Readonly<Record<string, string>>; readonly file: AiTransportFile };

/** How a transport writes a resolved attachment source into its JSON pointer. */
export type AiJsonAttachmentMaterialization = "raw-base64" | "data-url-base64";

export interface AiTransportJsonAttachment {
  readonly pointer: string;
  readonly source: AiMediaSource;
  /** Required by data-url materialization and retained for native URI resolution. */
  readonly mimeType: string;
  /** input_audio.data uses raw base64; image_url.url uses a data URL. */
  readonly materialization: AiJsonAttachmentMaterialization;
}

export interface AiTransportFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly source: AiMediaSource;
}

/**
 * Serializable DTO sent to an environment-specific transport. `path` is
 * deliberately relative: the transport owns its Base URL and credentials.
 */
export interface AiTransportRequest {
  readonly version: "ai-transport.v1";
  readonly path: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AiTransportBody;
  readonly responseMode: "json" | "stream";
  readonly timeoutMs?: number;
}

export type AiTransportResponseBody =
  | { readonly kind: "json"; readonly text: string }
  | { readonly kind: "stream"; readonly chunks: AsyncIterable<string> };

/** Raw transport result. Stream chunks are intentionally not parsed here. */
export interface AiTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AiTransportResponseBody;
}

export interface AiTransport {
  request(request: AiTransportRequest): Promise<AiTransportResponse>;
}

export type AiTranscriptionRequest = {
  readonly data: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
  readonly uri?: never;
} | {
  readonly uri: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly data?: never;
};

export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
  transcribe(request: AiTranscriptionRequest): Promise<string>;
}

export interface OpenAiCompatibleProviderConfig {
  /** The runtime owns networking, Base URL and credentials. */
  readonly transport: AiTransport;
  readonly models: {
    readonly text?: string;
    readonly vision?: string;
    readonly asr?: string;
  };
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema?: boolean;
  readonly asrTransport: "audio-transcriptions" | "chat-input-audio" | "stepaudio-sse";
  readonly contextWindowTokens: number;
  readonly reasoningMode: "provider-default";
  readonly retryDelaysMs?: readonly number[];
  readonly timeoutMs?: number;
}
