import type {
  AiMediaSource,
  AiTransportBody,
  AiTransportJsonAttachment,
  AiTransportRequest,
} from "@hongtai/ai";
import type {
  NativeAiJsonAttachment,
  NativeAiMediaSource,
  NativeAiRequestBody,
  NativeAiRequestEvent,
  NativeAiRequestStart,
} from "./standalone-bridge.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MIME_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const SAFE_ENDPOINT_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;
const FORBIDDEN_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "api_key",
  "x-auth-token",
  "x-access-token",
]);
const FORBIDDEN_BODY_FIELD_NAMES = new Set([
  "authorization",
  "api_key",
  "api-key",
  "apikey",
  "access_token",
  "token",
]);

/** A safe native transport failure, intentionally free of raw provider data. */
export class NativeAiTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "NativeAiTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`AI ${label} is required`);
  return value;
}

function publicMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "本地 AI 请求失败";
  const trimmed = value.trim().slice(0, 280);
  if (/\b(?:authorization|api[_-]?key|bearer)\b|(?:file|content):\/\/|[A-Za-z]:[\\/]|\/(?:data|storage|private)\//i.test(trimmed)) {
    return "本地 AI 请求失败";
  }
  return trimmed;
}

export function requestId(value: string): string {
  if (!REQUEST_ID_PATTERN.test(value)) throw new TypeError("AI request ID is invalid");
  return value;
}

export function generatedRequestId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new TypeError("Secure random AI request ID is unavailable");
  return requestId(`ai-${value}`);
}

function relativePath(value: unknown): string {
  const path = requiredString(value, "relative endpoint").trim();
  if (!path || path.startsWith("/") || path.startsWith("?") || path.startsWith("#") ||
      path.includes("://") || path.includes("\\") || path.includes("?") || path.includes("#")) {
    throw new TypeError("AI request must use a relative endpoint");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !SAFE_ENDPOINT_SEGMENT.test(segment))) {
    throw new TypeError("AI request must use a relative endpoint");
  }
  return path;
}

function safeHeaderName(value: string): string {
  if (!HEADER_NAME_PATTERN.test(value)) throw new TypeError("AI request header name is invalid");
  const normalized = value.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.has(normalized)) throw new TypeError("AI request may not include a credential header");
  return normalized;
}

function normalizedRequestHeaders(headers: unknown): Readonly<Record<string, string>> {
  if (!isRecord(headers)) throw new TypeError("AI request headers are invalid");
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = safeHeaderName(name);
    if (typeof value !== "string" || /[\r\n]/.test(value)) throw new TypeError("AI request header value is invalid");
    result[normalized] = value;
  }
  return result;
}

function validMimeType(value: unknown): string {
  const mimeType = requiredString(value, "attachment MIME type");
  if (!MIME_TYPE_PATTERN.test(mimeType)) throw new TypeError("AI attachment MIME type is invalid");
  return mimeType;
}

function privateUri(value: unknown): string {
  const uri = requiredString(value, "private media URI");
  if (uri.startsWith("/") || uri.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(uri)) {
    throw new TypeError("AI attachment must be a private URI, not an absolute path");
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("AI attachment must be a private URI");
  }
  if (parsed.protocol !== "file:" || !uri.startsWith("file:///")) {
    throw new TypeError("AI attachment must be a private URI");
  }
  return uri;
}

function toNativeSource(source: AiMediaSource): NativeAiMediaSource {
  if (!isRecord(source) || (source.kind !== "base64" && source.kind !== "uri")) {
    throw new TypeError("AI attachment source is invalid");
  }
  if (source.kind === "base64") {
    return { kind: "base64", base64: requiredString(source.base64, "attachment base64") };
  }
  return { kind: "uri", uri: privateUri(source.uri) };
}

function pointer(value: unknown): string {
  const raw = requiredString(value, "attachment pointer");
  if (!raw.startsWith("/") || raw === "/") throw new TypeError("AI attachment pointer is invalid");
  const segments = raw.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.some((segment) => !segment || segment === "__proto__" || segment === "constructor" || segment === "prototype")) {
    throw new TypeError("AI attachment pointer is unsafe");
  }
  return raw;
}

function jsonAttachments(value: readonly AiTransportJsonAttachment[] | undefined): readonly NativeAiJsonAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("AI JSON attachments are invalid");
  return value.map((attachment) => ({
    pointer: pointer(attachment.pointer),
    source: toNativeSource(attachment.source),
    mimeType: validMimeType(attachment.mimeType),
    materialization: attachment.materialization === "raw-base64" || attachment.materialization === "data-url-base64"
      ? attachment.materialization
      : (() => { throw new TypeError("AI attachment materialization is invalid"); })(),
  }));
}

function safeFilename(value: unknown): string {
  const filename = requiredString(value, "attachment filename");
  if (filename.includes("/") || filename.includes("\\") || filename === "." || filename === ".." || hasAsciiControlCharacter(filename)) {
    throw new TypeError("AI multipart filename must not be a path");
  }
  return filename;
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function requireCredentialFreeJson(value: string): void {
  let document: unknown;
  try {
    document = JSON.parse(value);
  } catch {
    throw new TypeError("AI JSON body is invalid");
  }
  if (!isRecord(document) && !Array.isArray(document)) {
    throw new TypeError("AI JSON body is invalid");
  }
  requireCredentialFreeJsonValue(document);
}

function requireCredentialFreeJsonValue(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(requireCredentialFreeJsonValue);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, nested] of Object.entries(value)) {
    if (FORBIDDEN_BODY_FIELD_NAMES.has(name.toLowerCase())) {
      throw new TypeError("AI JSON body may not include credentials");
    }
    requireCredentialFreeJsonValue(nested);
  }
}

function toNativeBody(body: AiTransportBody): NativeAiRequestBody {
  if (!isRecord(body) || (body.kind !== "json" && body.kind !== "multipart")) {
    throw new TypeError("AI request body is invalid");
  }
  if (body.kind === "json") {
    const json = requiredString(body.json, "JSON body");
    requireCredentialFreeJson(json);
    const attachments = jsonAttachments(body.attachments);
    return { kind: "json", json, ...(attachments ? { attachments } : {}) };
  }
  if (!isRecord(body.fields) || !isRecord(body.file)) throw new TypeError("AI multipart body is invalid");
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(body.fields)) {
    if (!HEADER_NAME_PATTERN.test(name) || FORBIDDEN_BODY_FIELD_NAMES.has(name.toLowerCase()) || typeof value !== "string") {
      throw new TypeError("AI multipart body may not include credentials");
    }
    fields[name] = value;
  }
  return {
    kind: "multipart",
    fields,
    file: {
      filename: safeFilename(body.file.filename),
      mimeType: validMimeType(body.file.mimeType),
      source: toNativeSource(body.file.source),
    },
  };
}

function timeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value)) {
    throw new TypeError("AI request timeout is invalid");
  }
  return value;
}

export function toNativeRequest(request: AiTransportRequest, id: string): NativeAiRequestStart {
  if (!isRecord(request) || request.version !== "ai-transport.v1" || request.method !== "POST" ||
      (request.responseMode !== "json" && request.responseMode !== "stream")) {
    throw new TypeError("AI transport request is invalid");
  }
  const timeoutMs = timeout(request.timeoutMs);
  return {
    version: "ai-transport.v1",
    requestId: id,
    relativePath: relativePath(request.path),
    method: "POST",
    headers: normalizedRequestHeaders(request.headers),
    body: toNativeBody(request.body),
    responseMode: request.responseMode,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export function responseHeaders(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new NativeAiTransportError("ERR_AI_RESPONSE_INVALID", "本地 AI 响应头无效");
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string" || /[\r\n]/.test(item) || !HEADER_NAME_PATTERN.test(name)) continue;
    const normalized = name.toLowerCase();
    if (!FORBIDDEN_HEADER_NAMES.has(normalized)) result[normalized] = item;
  }
  return result;
}

export function responseStatus(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    throw new NativeAiTransportError("ERR_AI_RESPONSE_INVALID", "本地 AI 响应状态无效");
  }
  return value;
}

export function safeNativeFailure(event: Extract<NativeAiRequestEvent, { readonly type: "failed" }>): NativeAiTransportError {
  const code = typeof event.code === "string" && /^[A-Z0-9_]{3,120}$/.test(event.code)
    ? event.code
    : "ERR_AI_REQUEST_FAILED";
  return new NativeAiTransportError(code, publicMessage(event.userMessage), event.retryable === true);
}

export function safeBridgeFailure(error: unknown): NativeAiTransportError {
  if (error instanceof NativeAiTransportError) return error;
  const native = isRecord(error) ? error : undefined;
  const code = typeof native?.code === "string" && /^[A-Z0-9_]{3,120}$/.test(native.code)
    ? native.code
    : "ERR_NATIVE_AI_UNAVAILABLE";
  return new NativeAiTransportError(code, publicMessage(native?.message), native?.retryable === true);
}
