import { TaskError } from "@hongtai/core";
import type {
  NativeLinkDiagnosticErrorClass,
  NativeLinkDiagnosticPhase,
  NativeLinkDiagnosticV1,
  NativeNetworkType,
} from "@hongtai/core";

const DIAGNOSTIC_PHASES = new Set<NativeLinkDiagnosticPhase>([
  "request", "connect", "redirect", "response", "decode",
]);
const ERROR_CLASSES = new Set<NativeLinkDiagnosticErrorClass>([
  "dns",
  "tls",
  "connection",
  "timeout",
  "redirect_limit",
  "redirect_invalid",
  "response_too_large",
  "response_invalid_encoding",
  "response_io",
  "invalid_request",
]);
const NETWORK_TYPES = new Set<NativeNetworkType>([
  "wifi", "cellular", "ethernet", "vpn", "offline", "other", "unknown",
]);
const SAFE_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

interface NativeLinkFailureMapping {
  readonly code: ConstructorParameters<typeof TaskError>[0]["code"];
  readonly message: string;
  readonly action: ConstructorParameters<typeof TaskError>[0]["action"];
  readonly retryable: boolean;
}

const FAILURE_MAPPINGS: Readonly<Record<string, NativeLinkFailureMapping>> = {
  ERR_LINK_DNS_FAILED: {
    code: "LINK_NETWORK_FAILED",
    message: "域名解析失败，请检查网络后重试",
    action: "check_network",
    retryable: true,
  },
  ERR_LINK_TLS_FAILED: {
    code: "LINK_NETWORK_FAILED",
    message: "页面安全连接建立失败，请检查网络或系统时间后重试",
    action: "check_network",
    retryable: true,
  },
  ERR_LINK_CONNECTION_FAILED: {
    code: "LINK_NETWORK_FAILED",
    message: "无法连接到页面主机，请检查网络后重试",
    action: "check_network",
    retryable: true,
  },
  ERR_LINK_TIMEOUT: {
    code: "LINK_TIMEOUT",
    message: "页面抓取超时，请检查网络后重试",
    action: "check_network",
    retryable: true,
  },
  ERR_LINK_REDIRECT_LIMIT: {
    code: "LINK_REDIRECT_LIMIT",
    message: "链接跳转次数过多，请更换公开作品链接",
    action: "edit_input",
    retryable: false,
  },
  ERR_LINK_REDIRECT_INVALID: {
    code: "LINK_REDIRECT_INVALID",
    message: "链接跳转地址无效，请更换公开作品链接",
    action: "edit_input",
    retryable: false,
  },
  ERR_LINK_RESPONSE_TOO_LARGE: {
    code: "LINK_HTTP_ERROR",
    message: "页面响应超出安全解析限制",
    action: "retry",
    retryable: false,
  },
  ERR_LINK_RESPONSE_INVALID: {
    code: "LINK_HTTP_ERROR",
    message: "页面响应格式不符合安全解析要求",
    action: "retry",
    retryable: false,
  },
  ERR_LINK_RESPONSE_FAILED: {
    code: "LINK_NETWORK_FAILED",
    message: "页面响应读取失败，请检查网络后重试",
    action: "check_network",
    retryable: true,
  },
  ERR_LINK_REQUEST_INVALID: {
    code: "LINK_HTTP_ERROR",
    message: "页面请求不符合安全限制",
    action: "edit_input",
    retryable: false,
  },
};

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : undefined;
}

function integerIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function nativeLinkDiagnostic(value: unknown): NativeLinkDiagnosticV1 | undefined {
  const source = record(value);
  if (!source || source.schemaVersion !== "native-link-diagnostic.v1" || source.operation !== "fetch-text") return undefined;
  const phase = source.phase;
  const errorClass = source.errorClass;
  const elapsedMs = integerIn(source.elapsedMs, 0, 600_000);
  const attempt = integerIn(source.attempt, 1, 3);
  const redirectCount = integerIn(source.redirectCount, 0, 5);
  if (typeof phase !== "string" || !DIAGNOSTIC_PHASES.has(phase as NativeLinkDiagnosticPhase)) return undefined;
  if (typeof errorClass !== "string" || !ERROR_CLASSES.has(errorClass as NativeLinkDiagnosticErrorClass)) return undefined;
  if (elapsedMs === undefined || attempt === undefined || redirectCount === undefined) return undefined;

  const hostname = typeof source.hostname === "string"
    && SAFE_HOSTNAME.test(source.hostname)
    && !IPV4_LITERAL.test(source.hostname)
    ? source.hostname
    : undefined;
  const networkType = typeof source.networkType === "string" && NETWORK_TYPES.has(source.networkType as NativeNetworkType)
    ? source.networkType as NativeNetworkType
    : undefined;
  return {
    schemaVersion: "native-link-diagnostic.v1",
    operation: "fetch-text",
    phase: phase as NativeLinkDiagnosticPhase,
    ...(hostname ? { hostname } : {}),
    errorClass: errorClass as NativeLinkDiagnosticErrorClass,
    elapsedMs,
    ...(networkType ? { networkType } : {}),
    attempt,
    redirectCount,
  };
}

export function mappedNativeLinkError(error: unknown): TaskError | undefined {
  const source = record(error);
  const nativeCode = typeof source?.code === "string" ? source.code : undefined;
  const mapping = nativeCode ? FAILURE_MAPPINGS[nativeCode] : undefined;
  if (!nativeCode || !mapping) return undefined;
  return new TaskError({
    code: mapping.code,
    message: mapping.message,
    action: mapping.action,
    retryable: mapping.retryable,
    details: { nativeCode },
    diagnostic: nativeLinkDiagnostic(source?.data),
  });
}
