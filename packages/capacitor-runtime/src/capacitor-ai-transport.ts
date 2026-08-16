import type {
  AiTransport,
  AiTransportRequest,
  AiTransportResponse,
} from "@hongtai/ai";
import type {
  NativeAiListenerHandle,
  NativeAiRequestEvent,
  StandaloneNativeNetworkPlugin,
} from "./standalone-bridge.js";
import { AsyncStringQueue } from "./async-string-queue.js";
import {
  generatedRequestId,
  isRecord,
  NativeAiTransportError,
  requestId,
  responseHeaders,
  responseStatus,
  safeBridgeFailure,
  safeNativeFailure,
  toNativeRequest,
} from "./capacitor-ai-transport-mapping.js";

export { NativeAiTransportError };

export interface CapacitorAiTransportOptions {
  /**
   * The app shell supplies the native bridge. This constructor intentionally
   * has no Base URL, API Key, connection ID, or generic HTTP client option.
   */
  readonly nativeNetwork: Pick<StandaloneNativeNetworkPlugin, "startAiRequest" | "addListener">;
  /** Deterministic only for tests; production uses a cryptographic UUID. */
  readonly createRequestId?: () => string;
}

interface PendingRequest {
  readonly responseMode: AiTransportRequest["responseMode"];
  readonly chunks: AsyncStringQueue;
  readonly completion: Promise<string>;
  resolveCompletion(value: string): void;
  rejectCompletion(error: unknown): void;
  lastSequence: number;
  settled: boolean;
}

/**
 * Native-only OpenAI-compatible transport. It maps the shared protocol to a
 * fixed Capacitor bridge; Base URL and API Key remain wholly in Android.
 */
export class CapacitorAiTransport implements AiTransport {
  readonly #nativeNetwork: Pick<StandaloneNativeNetworkPlugin, "startAiRequest" | "addListener">;
  readonly #createRequestId: () => string;
  readonly #pending = new Map<string, PendingRequest>();
  #listenerReady: Promise<NativeAiListenerHandle> | undefined;

  constructor(options: CapacitorAiTransportOptions) {
    this.#nativeNetwork = options.nativeNetwork;
    this.#createRequestId = options.createRequestId ?? generatedRequestId;
  }

  async request(request: AiTransportRequest): Promise<AiTransportResponse> {
    const id = requestId(this.#createRequestId());
    const nativeRequest = toNativeRequest(request, id);
    await this.#ensureListener();

    const pending = this.#newPending(request.responseMode);
    this.#pending.set(id, pending);
    let started: Awaited<ReturnType<StandaloneNativeNetworkPlugin["startAiRequest"]>>;
    try {
      started = await this.#nativeNetwork.startAiRequest(nativeRequest);
      if (!isRecord(started) || started.requestId !== id || started.accepted !== true) {
        throw new NativeAiTransportError("ERR_AI_REQUEST_NOT_ACCEPTED", "本地 AI 请求未被安全接收");
      }
    } catch (error) {
      const safeError = safeBridgeFailure(error);
      this.#finishWithError(id, safeError);
      throw safeError;
    }

    let response: { readonly status: number; readonly headers: Readonly<Record<string, string>> };
    try {
      response = {
        status: responseStatus(started.status),
        headers: responseHeaders(started.headers),
      };
    } catch (error) {
      this.#finishWithError(id, error);
      throw error;
    }
    if (request.responseMode === "stream") {
      return { ...response, body: { kind: "stream", chunks: pending.chunks.iterate() } };
    }
    try {
      const text = await pending.completion;
      return { ...response, body: { kind: "json", text } };
    } finally {
      this.#pending.delete(id);
    }
  }

  async #ensureListener(): Promise<void> {
    if (!this.#listenerReady) {
      this.#listenerReady = Promise.resolve(this.#nativeNetwork.addListener("aiRequestEvent", (event) => {
        this.#onNativeEvent(event);
      }));
    }
    try {
      const handle = await this.#listenerReady;
      if (!handle || typeof handle.remove !== "function") throw new TypeError("Native AI listener is invalid");
    } catch (error) {
      this.#listenerReady = undefined;
      throw safeBridgeFailure(error);
    }
  }

  #newPending(responseMode: AiTransportRequest["responseMode"]): PendingRequest {
    let resolveCompletion!: (value: string) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // Stream mode never awaits JSON completion. Keep a sink attached so a
    // native stream failure is surfaced through its AsyncIterable without
    // also becoming an unhandled rejected promise.
    void completion.catch(() => undefined);
    return {
      responseMode,
      chunks: new AsyncStringQueue(),
      completion,
      resolveCompletion,
      rejectCompletion,
      lastSequence: 0,
      settled: false,
    };
  }

  #onNativeEvent(event: NativeAiRequestEvent): void {
    if (!isRecord(event) || typeof event.requestId !== "string") return;
    const pending = this.#pending.get(event.requestId);
    if (!pending || pending.settled) return;
    try {
      if (!Number.isSafeInteger(event.sequence) || event.sequence !== pending.lastSequence + 1) {
        throw new NativeAiTransportError("ERR_AI_EVENT_SEQUENCE", "本地 AI 流事件顺序无效");
      }
      pending.lastSequence = event.sequence;
      if (event.type === "chunk") {
        if (pending.responseMode !== "stream" || typeof event.chunk !== "string") {
          throw new NativeAiTransportError("ERR_AI_EVENT_INVALID", "本地 AI 流事件无效");
        }
        pending.chunks.push(event.chunk);
        return;
      }
      if (event.type === "completed") {
        if (pending.responseMode === "json") {
          if (typeof event.bodyText !== "string") {
            throw new NativeAiTransportError("ERR_AI_RESPONSE_INVALID", "本地 AI JSON 响应缺少正文");
          }
          pending.resolveCompletion(event.bodyText);
        } else if (event.bodyText !== undefined) {
          throw new NativeAiTransportError("ERR_AI_EVENT_INVALID", "本地 AI 流完成事件无效");
        }
        pending.settled = true;
        pending.chunks.close();
        this.#pending.delete(event.requestId);
        return;
      }
      if (event.type === "failed") {
        this.#finishWithError(event.requestId, safeNativeFailure(event));
        return;
      }
      throw new NativeAiTransportError("ERR_AI_EVENT_INVALID", "本地 AI 事件类型无效");
    } catch (error) {
      this.#finishWithError(event.requestId, error);
    }
  }

  #finishWithError(requestIdValue: string, error: unknown): void {
    const pending = this.#pending.get(requestIdValue);
    if (!pending || pending.settled) return;
    pending.settled = true;
    pending.chunks.fail(error);
    pending.rejectCompletion(error);
    this.#pending.delete(requestIdValue);
  }
}
