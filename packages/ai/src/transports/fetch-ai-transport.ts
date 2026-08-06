import type {
  AiMediaSource,
  AiTransport,
  AiTransportBody,
  AiTransportJsonAttachment,
  AiTransportRequest,
  AiTransportResponse,
} from "../contracts/provider";

export interface FetchAiTransportConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sourceBytes(source: AiMediaSource): Uint8Array {
  if (source.kind === "uri") {
    throw new TypeError("FetchAiTransport cannot read a native media URI");
  }
  return decodeBase64(source.base64);
}

function validatedMimeType(value: string): string {
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value)) {
    throw new TypeError("AI transport attachment has an invalid MIME type");
  }
  return value;
}

function materializeAttachment(attachment: AiTransportJsonAttachment): string {
  if (attachment.source.kind === "uri") {
    throw new TypeError("FetchAiTransport cannot read a native media URI");
  }
  const mimeType = validatedMimeType(attachment.mimeType);
  return attachment.materialization === "raw-base64"
    ? attachment.source.base64
    : `data:${mimeType};base64,${attachment.source.base64}`;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/")) throw new TypeError("AI transport attachment pointer must be a JSON pointer");
  return pointer.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function isUnsafePointerSegment(segment: string): boolean {
  return segment === "__proto__" || segment === "constructor" || segment === "prototype";
}

function arrayIndex(segment: string, length: number): number {
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new TypeError("AI transport attachment pointer must target an array index");
  const index = Number(segment);
  if (!Number.isSafeInteger(index) || index >= length) throw new TypeError("AI transport attachment pointer is out of range");
  return index;
}

function setJsonPointer(payload: unknown, pointer: string, value: string): void {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) throw new TypeError("AI transport attachment pointer cannot replace the document root");
  let current: unknown = payload;
  for (const segment of segments.slice(0, -1)) {
    if (isUnsafePointerSegment(segment)) throw new TypeError("AI transport attachment pointer is unsafe");
    if (Array.isArray(current)) {
      current = current[arrayIndex(segment, current.length)];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new TypeError("AI transport attachment pointer does not exist");
    }
    current = (current as Record<string, unknown>)[segment];
  }
  const target = segments.at(-1);
  if (!target || isUnsafePointerSegment(target)) throw new TypeError("AI transport attachment pointer is unsafe");
  if (Array.isArray(current)) {
    current[arrayIndex(target, current.length)] = value;
    return;
  }
  if (!current || typeof current !== "object" || !Object.hasOwn(current, target)) {
    throw new TypeError("AI transport attachment pointer does not exist");
  }
  (current as Record<string, unknown>)[target] = value;
}

function materializeJsonBody(body: Extract<AiTransportBody, { readonly kind: "json" }>): string {
  if (!body.attachments?.length) return body.json;
  const payload = JSON.parse(body.json) as unknown;
  for (const attachment of body.attachments) {
    setJsonPointer(payload, attachment.pointer, materializeAttachment(attachment));
  }
  return JSON.stringify(payload);
}

function toFetchBody(body: AiTransportBody): BodyInit {
  if (body.kind === "json") {
    return materializeJsonBody(body);
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(body.fields)) form.set(name, value);
  const bytes = sourceBytes(body.file.source);
  const fileBytes = new Uint8Array(bytes.byteLength);
  fileBytes.set(bytes);
  form.set("file", new File([fileBytes], body.file.filename, { type: body.file.mimeType }));
  return form;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => { result[name.toLowerCase()] = value; });
  return result;
}

async function* responseChunks(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.value) {
        const text = decoder.decode(next.value, { stream: !next.done });
        if (text) yield text;
      }
      if (next.done) break;
    }
    const trailing = decoder.decode();
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

/** Node/Web fallback. It is the only AI package component that knows an API Key. */
export class FetchAiTransport implements AiTransport {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetchImpl?: typeof fetch;

  constructor(config: FetchAiTransportConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#apiKey = config.apiKey;
    this.#fetchImpl = config.fetchImpl;
  }

  async request(request: AiTransportRequest): Promise<AiTransportResponse> {
    const response = await (this.#fetchImpl ?? globalThis.fetch)(`${this.#baseUrl}/${request.path.replace(/^\/+/, "")}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${this.#apiKey}`, ...request.headers },
      body: toFetchBody(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? 90_000),
    });
    return {
      status: response.status,
      headers: responseHeaders(response.headers),
      body: request.responseMode === "stream" && response.headers.get("content-type")?.includes("text/event-stream")
        ? { kind: "stream", chunks: responseChunks(response) }
        : { kind: "json", text: await response.text() },
    };
  }
}

export function createFetchAiTransport(config: FetchAiTransportConfig): FetchAiTransport {
  return new FetchAiTransport(config);
}
