import { persistableSuccessRaw, platformForHost, TaskError, type HttpClient, type MediaSource, type PlatformAdapter, type PlatformContent, type ResolvedLink } from "@hongtai/core";
import {
  DESKTOP_USER_AGENT,
  asArray,
  asNumber,
  asRecord,
  asString,
  dedupeMedia,
  followRedirectLocation,
  mediaHeaders,
  normalizeHttpUrl,
} from "../shared";
import { signWbiQuery, wbiKeysFromNav } from "./wbi";

const SHORT_LINK_HOPS = 5;
const PUBLIC_QN = 64;

function extractBvid(url: string): string | undefined {
  return url.match(/\b(BV[0-9A-Za-z]{10})\b/i)?.[1];
}

function extractAid(url: string): number | undefined {
  const fromPath = url.match(/\/video\/av(\d+)\b/i)?.[1];
  const raw = fromPath ?? (() => {
    try {
      return new URL(url).searchParams.get("aid") ?? undefined;
    } catch {
      return undefined;
    }
  })();
  const aid = Number(raw);
  return Number.isSafeInteger(aid) && aid > 0 ? aid : undefined;
}

function extractPage(url: string): number | undefined {
  try {
    const page = Number(new URL(url).searchParams.get("p"));
    return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
  } catch {
    return undefined;
  }
}

function hasVideoId(url: string): boolean {
  return Boolean(extractBvid(url) ?? extractAid(url));
}

function assertBilibiliUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TaskError({ code: "LINK_REDIRECT_INVALID", message: "B站返回了无效作品地址", action: "edit_input", cause: error });
  }
  if (parsed.protocol !== "https:" || platformForHost(parsed.hostname) !== "bilibili") {
    throw new TaskError({
      code: "LINK_REDIRECT_INVALID",
      message: "B站链接跳转到了未认可的地址",
      action: "edit_input",
      details: { hostname: parsed.hostname.toLowerCase() || "unknown" },
    });
  }
  return parsed.toString();
}

async function getApi(http: HttpClient, url: string, referer: string): Promise<Record<string, unknown>> {
  const response = await http.get({
    url,
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: referer,
      Accept: "application/json,text/plain,*/*",
    },
    maxRedirects: 2,
    timeoutMs: 30_000,
  });
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) throw new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: "B站视频需要登录或没有访问权限", action: "edit_input", details: { httpStatus: response.status } });
    if (response.status === 404) throw new TaskError({ code: "CONTENT_NOT_FOUND", message: "B站视频不存在或链接已经失效", action: "edit_input", details: { httpStatus: 404 } });
    if (response.status === 429) throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "B站API访问过于频繁", retryable: true, action: "wait_and_retry", details: { httpStatus: 429 } });
    if (response.status >= 500) throw new TaskError({ code: "PLATFORM_API_UNAVAILABLE", message: "B站API暂时不可用", retryable: true, action: "wait_and_retry", details: { httpStatus: response.status } });
    throw new TaskError({ code: "LINK_HTTP_ERROR", message: `B站API请求失败：HTTP ${response.status}`, action: "retry", details: { httpStatus: response.status } });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch (error) {
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "B站API返回了无效JSON", action: "retry", cause: error });
  }
  const record = asRecord(payload);
  if (!record) throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: "B站API返回格式无效", action: "retry" });
  const apiCode = asNumber(record.code);
  if (apiCode !== 0) {
    if (apiCode === -404) throw new TaskError({ code: "CONTENT_NOT_FOUND", message: "B站视频不存在或已经删除", action: "edit_input", details: { providerCode: apiCode } });
    if (apiCode === -403) throw new TaskError({ code: "CONTENT_PRIVATE_OR_LOGIN_REQUIRED", message: "B站视频没有访问权限", action: "edit_input", details: { providerCode: apiCode } });
    if (apiCode === -352) throw new TaskError({ code: "PLATFORM_RISK_CONTROLLED", message: "B站触发风控，暂时无法获取公开播放信息", retryable: false, action: "wait_and_retry", details: { providerCode: apiCode } });
    if (apiCode === -412) throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "B站请求触发访问限制，请稍后重试", retryable: true, action: "wait_and_retry", details: { providerCode: apiCode } });
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: `B站API返回错误：${asString(record.message) ?? apiCode}`, action: "retry", details: { providerCode: apiCode ?? "unknown" } });
  }
  return record;
}

async function fetchWbiKeys(http: HttpClient, referer: string): Promise<{ imgKey: string; subKey: string } | undefined> {
  try {
    const response = await http.get({
      url: "https://api.bilibili.com/x/web-interface/nav",
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        Referer: referer,
        Accept: "application/json,text/plain,*/*",
      },
      maxRedirects: 2,
      timeoutMs: 30_000,
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    return wbiKeysFromNav(JSON.parse(response.body) as unknown);
  } catch {
    return undefined;
  }
}

function dashSources(playData: Record<string, unknown>, referer: string): {
  videos: MediaSource[];
  audios: MediaSource[];
} {
  const headers = mediaHeaders(referer);
  const dash = asRecord(playData.dash);
  const videos: MediaSource[] = [];
  const audios: MediaSource[] = [];

  for (const value of asArray(dash?.video)) {
    const item = asRecord(value);
    if (!item) continue;
    const url = normalizeHttpUrl(item.baseUrl) ?? normalizeHttpUrl(item.base_url);
    if (!url) continue;
    videos.push({
      kind: "video",
      url,
      quality: String(asNumber(item.id) ?? "unknown"),
      codec: asString(item.codecs),
      mimeType: asString(item.mimeType) ?? asString(item.mime_type),
      bitrate: asNumber(item.bandwidth),
      width: asNumber(item.width),
      height: asNumber(item.height),
      hasWatermark: false,
      headers,
    });
  }
  for (const value of asArray(dash?.audio)) {
    const item = asRecord(value);
    if (!item) continue;
    const url = normalizeHttpUrl(item.baseUrl) ?? normalizeHttpUrl(item.base_url);
    if (!url) continue;
    audios.push({
      kind: "audio",
      url,
      quality: String(asNumber(item.id) ?? "audio"),
      codec: asString(item.codecs),
      mimeType: asString(item.mimeType) ?? asString(item.mime_type),
      bitrate: asNumber(item.bandwidth),
      headers,
    });
  }

  if (videos.length === 0) {
    for (const value of asArray(playData.durl)) {
      const item = asRecord(value);
      const url = normalizeHttpUrl(item?.url);
      if (url) videos.push({ kind: "video", url, quality: "combined", hasWatermark: false, headers });
    }
  }
  return { videos: dedupeMedia(videos), audios: dedupeMedia(audios) };
}

export class BilibiliAdapter implements PlatformAdapter {
  readonly platform = "bilibili" as const;
  readonly supportLevel = "stable" as const;

  matches(url: string): boolean {
    try {
      return platformForHost(new URL(url).hostname) === "bilibili";
    } catch {
      return false;
    }
  }

  async resolve(url: string, http: HttpClient): Promise<ResolvedLink> {
    if (hasVideoId(url)) return { sourceUrl: url, finalUrl: url, status: 200 };
    const headers = {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: "https://www.bilibili.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    };
    let current = url;
    for (let hop = 0; hop < SHORT_LINK_HOPS; hop += 1) {
      const response = await followRedirectLocation(http, current, headers);
      const next = assertBilibiliUrl(response.url);
      if (hasVideoId(next)) return { sourceUrl: url, finalUrl: next, status: response.status };
      if (next === current) {
        throw new TaskError({ code: "INPUT_URL_INVALID", message: "无法从B站链接中提取BV号或av号", action: "edit_input" });
      }
      current = next;
    }
    throw new TaskError({
      code: "LINK_REDIRECT_LIMIT",
      message: `B站短链跳转超过${SHORT_LINK_HOPS}次，可能已经失效`,
      action: "edit_input",
      details: { maxRedirects: SHORT_LINK_HOPS },
    });
  }

  async parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent> {
    const bvid = extractBvid(link.finalUrl) ?? extractBvid(link.sourceUrl);
    const aid = extractAid(link.finalUrl) ?? extractAid(link.sourceUrl);
    if (!bvid && !aid) throw new TaskError({ code: "INPUT_URL_INVALID", message: "无法从B站链接中提取BV号或av号", action: "edit_input" });
    const page = extractPage(link.finalUrl) ?? extractPage(link.sourceUrl) ?? 1;
    const viewQuery = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${aid}`;
    const viewPayload = await getApi(
      http,
      `https://api.bilibili.com/x/web-interface/view?${viewQuery}`,
      link.finalUrl,
    );
    const view = asRecord(viewPayload.data);
    if (!view) throw new TaskError({ code: "CONTENT_PARSE_FAILED", message: "B站视频信息为空", action: "retry" });
    const resolvedBvid = asString(view.bvid) ?? bvid;
    const pages = asArray(view.pages);
    const selectedPage = asRecord(pages[page - 1]);
    const cid = asNumber(selectedPage?.cid) ?? (page === 1 ? asNumber(view.cid) : undefined);
    if (!cid) {
      throw new TaskError({
        code: "CONTENT_TYPE_UNSUPPORTED",
        message: `B站视频没有可用的P${page}信息`,
        action: "edit_input",
        details: { page },
      });
    }
    const playParams: Record<string, string | number> = {
      ...(resolvedBvid ? { bvid: resolvedBvid } : { aid: aid ?? 0 }),
      cid,
      qn: PUBLIC_QN,
      fnval: 16,
      fnver: 0,
    };
    const wbiKeys = await fetchWbiKeys(http, link.finalUrl);
    const playQuery = wbiKeys
      ? signWbiQuery(playParams, wbiKeys.imgKey, wbiKeys.subKey, Math.floor(Date.now() / 1000))
      : new URLSearchParams(Object.fromEntries(Object.entries(playParams).map(([key, value]) => [key, String(value)]))).toString();
    const playPath = wbiKeys ? "/x/player/wbi/playurl" : "/x/player/playurl";
    const playPayload = await getApi(http, `https://api.bilibili.com${playPath}?${playQuery}`, link.finalUrl);
    const playData = asRecord(playPayload.data);
    if (!playData) throw new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "B站播放信息为空", action: "retry" });
    const sources = dashSources(playData, link.finalUrl);
    if (sources.videos.length === 0) {
      throw new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "B站未返回可下载的公开播放源", action: "retry" });
    }
    const owner = asRecord(view.owner);
    const title = asString(view.title);
    const authorName = asString(owner?.name);
    const canonicalId = resolvedBvid ?? `av${aid}`;
    const canonicalUrl = `https://www.bilibili.com/video/${resolvedBvid ?? `av${aid}`}${page > 1 ? `?p=${page}` : ""}`;

    return {
      platform: this.platform,
      contentType: "video",
      id: canonicalId,
      sourceUrl: link.sourceUrl,
      canonicalUrl,
      title,
      description: asString(view.desc),
      author: authorName,
      coverUrl: normalizeHttpUrl(view.pic),
      durationSeconds: asNumber(selectedPage?.duration) ?? asNumber(view.duration),
      videos: sources.videos,
      audios: sources.audios,
      images: [],
      subtitles: [],
      raw: persistableSuccessRaw({
        platform: this.platform,
        id: canonicalId,
        contentType: "video",
        httpStatus: link.status,
        hasAuthor: Boolean(authorName),
        hasTitle: Boolean(title),
        videos: sources.videos,
        audios: sources.audios,
        images: [],
      }),
    };
  }
}
