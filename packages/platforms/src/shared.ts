import { TaskError, type HttpClient, type HttpResponse, type MediaSource } from "@hongtai/core";

export const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/**
 * Engagement scalars only. Rejects NaN, Infinity, negatives, non-integers,
 * and formatted fake strings such as "1.2w" or "2.4万". Digit-only strings
 * that already are a safe integer (Xiaohongshu `likedCount: "128"`) are kept.
 */
export function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) return undefined;
    return value;
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function engagementCounts(
  source: Record<string, unknown> | undefined,
  keys: {
    readonly likeCount: string;
    readonly favoriteCount: string;
    readonly commentCount: string;
    readonly shareCount: string;
    readonly playCount?: string;
  },
): {
  readonly likeCount?: number;
  readonly favoriteCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly playCount?: number;
} {
  if (!source) return {};
  const likeCount = readNonNegativeInt(source[keys.likeCount]);
  const favoriteCount = readNonNegativeInt(source[keys.favoriteCount]);
  const commentCount = readNonNegativeInt(source[keys.commentCount]);
  const shareCount = readNonNegativeInt(source[keys.shareCount]);
  const playCount = keys.playCount === undefined ? undefined : readNonNegativeInt(source[keys.playCount]);
  return {
    ...(likeCount === undefined ? {} : { likeCount }),
    ...(favoriteCount === undefined ? {} : { favoriteCount }),
    ...(commentCount === undefined ? {} : { commentCount }),
    ...(shareCount === undefined ? {} : { shareCount }),
    ...(playCount === undefined ? {} : { playCount }),
  };
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return asString(value);
  for (const item of asArray(value)) {
    const result = asString(item);
    if (result) return result;
  }
  return undefined;
}

export function normalizeHttpUrl(value: unknown, prefix?: string): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("http://")) return `https://${raw.slice("http://".length)}`;
  if (prefix) return `${prefix}${raw.replace(/^\/+/, "")}`;
  return undefined;
}

export async function fetchPage(
  http: HttpClient,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<HttpResponse> {
  const response = await http.get({ url, headers, maxRedirects: 5, timeoutMs: 30_000 });
  if (response.status === 401 || response.status === 403) {
    throw new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: "作品需要登录或没有访问权限", action: "edit_input", details: { httpStatus: response.status } });
  }
  if (response.status === 404) throw new TaskError({ code: "CONTENT_NOT_FOUND", message: "作品不存在或链接已经失效", action: "edit_input", details: { httpStatus: 404 } });
  if (response.status === 410) throw new TaskError({ code: "CONTENT_REMOVED", message: "作品已经被删除", action: "edit_input", details: { httpStatus: 410 } });
  if (response.status === 429) throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "平台访问过于频繁，请稍后重试", retryable: true, action: "wait_and_retry", details: { httpStatus: 429 } });
  if (response.status >= 500) throw new TaskError({ code: "PLATFORM_API_UNAVAILABLE", message: "平台服务暂时不可用", retryable: true, action: "wait_and_retry", details: { httpStatus: response.status } });
  if (response.status < 200 || response.status >= 400) throw new TaskError({ code: "LINK_HTTP_ERROR", message: `页面请求失败：HTTP ${response.status}`, action: "retry", details: { httpStatus: response.status } });
  return response;
}

/** Follow one Location hop. Callers must pass maxRedirects 0 via this helper, never read HTML. */
export async function followRedirectLocation(
  http: HttpClient,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<Pick<HttpResponse, "url" | "status">> {
  const response = await http.get({ url, headers, maxRedirects: 0, timeoutMs: 30_000 });
  if (response.status === 401 || response.status === 403) {
    throw new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: "作品需要登录或没有访问权限", action: "edit_input", details: { httpStatus: response.status } });
  }
  if (response.status === 404) throw new TaskError({ code: "CONTENT_NOT_FOUND", message: "作品不存在或链接已经失效", action: "edit_input", details: { httpStatus: 404 } });
  if (response.status === 410) throw new TaskError({ code: "CONTENT_REMOVED", message: "作品已经被删除", action: "edit_input", details: { httpStatus: 410 } });
  if (response.status === 429) throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "平台访问过于频繁，请稍后重试", retryable: true, action: "wait_and_retry", details: { httpStatus: 429 } });
  if (response.status >= 500) throw new TaskError({ code: "PLATFORM_API_UNAVAILABLE", message: "平台服务暂时不可用", retryable: true, action: "wait_and_retry", details: { httpStatus: response.status } });
  if (response.status >= 400) throw new TaskError({ code: "LINK_HTTP_ERROR", message: `页面请求失败：HTTP ${response.status}`, action: "retry", details: { httpStatus: response.status } });
  return { url: response.url, status: response.status };
}

export function contentStateError(body: string, platformName: string): TaskError {
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20_000).toLowerCase();
  if (/作品不存在|内容不存在|已删除|not found|does not exist/.test(text)) {
    return new TaskError({ code: "CONTENT_NOT_FOUND", message: `${platformName}作品不存在或已删除`, action: "edit_input" });
  }
  if (/请登录|登录后|无权限|私密|private|login required/.test(text)) {
    return new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: `${platformName}作品需要登录或没有访问权限`, action: "edit_input" });
  }
  return new TaskError({ code: "CONTENT_SCHEMA_CHANGED", message: `${platformName}页面结构已经变化，暂时无法解析`, action: "retry" });
}

function findBalancedObject(source: string, start: number): string | undefined {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

export function replaceUndefined(source: string): string {
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (source.startsWith("undefined", index)) {
      const before = index === 0 ? "" : source[index - 1] ?? "";
      const after = source[index + "undefined".length] ?? "";
      if (!/[0-9A-Za-z_$]/.test(before) && !/[0-9A-Za-z_$]/.test(after)) {
        output += "null";
        index += "undefined".length - 1;
        continue;
      }
    }
    output += character;
  }
  return output;
}

export function extractAssignedJson(html: string, markers: readonly string[]): unknown {
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) continue;
    const jsonText = findBalancedObject(html, objectStart);
    if (!jsonText) continue;
    try {
      return JSON.parse(replaceUndefined(jsonText));
    } catch {
      continue;
    }
  }
  return undefined;
}

export function findRecord(
  root: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  const queue: unknown[] = [root];
  const visited = new Set<object>();
  let inspected = 0;

  while (queue.length > 0 && inspected < 50_000) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;
    if (isRecord(value)) {
      if (predicate(value)) return value;
      queue.push(...Object.values(value));
    } else if (Array.isArray(value)) {
      queue.push(...value);
    }
  }
  return undefined;
}

export function dedupeMedia(sources: readonly MediaSource[]): MediaSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

export function mediaHeaders(referer: string): Readonly<Record<string, string>> {
  return { "User-Agent": DESKTOP_USER_AGENT, Referer: referer };
}
