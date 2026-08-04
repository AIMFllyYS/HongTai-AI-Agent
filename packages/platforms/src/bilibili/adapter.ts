import { TaskError, type HttpClient, type MediaSource, type PlatformAdapter, type PlatformContent, type ResolvedLink } from "@hongtai/core";
import {
  DESKTOP_USER_AGENT,
  asArray,
  asNumber,
  asRecord,
  asString,
  dedupeMedia,
  fetchPage,
  mediaHeaders,
  normalizeHttpUrl,
} from "../shared";

const BILIBILI_HOST = /(^|\.)(bilibili\.com|b23\.tv)$/i;

function extractBvid(url: string): string | undefined {
  return url.match(/\b(BV[0-9A-Za-z]{10})\b/i)?.[1];
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
    if (apiCode === -412) throw new TaskError({ code: "PLATFORM_API_RATE_LIMITED", message: "B站请求触发访问限制，请稍后重试", retryable: true, action: "wait_and_retry", details: { providerCode: apiCode } });
    throw new TaskError({ code: "PLATFORM_API_RESPONSE_INVALID", message: `B站API返回错误：${asString(record.message) ?? apiCode}`, action: "retry", details: { providerCode: apiCode ?? "unknown" } });
  }
  return record;
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

  matches(url: string): boolean {
    try {
      return BILIBILI_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  async resolve(url: string, http: HttpClient): Promise<ResolvedLink> {
    const response = await fetchPage(http, url, {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: "https://www.bilibili.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    return { sourceUrl: url, finalUrl: response.url, status: response.status, body: response.body };
  }

  async parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent> {
    const bvid = extractBvid(link.finalUrl) ?? extractBvid(link.body ?? "");
    if (!bvid) throw new TaskError({ code: "INPUT_URL_INVALID", message: "无法从B站链接中提取BV号", action: "edit_input" });
    const viewPayload = await getApi(
      http,
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      link.finalUrl,
    );
    const view = asRecord(viewPayload.data);
    if (!view) throw new TaskError({ code: "CONTENT_PARSE_FAILED", message: "B站视频信息为空", action: "retry" });
    const pages = asArray(view.pages);
    const firstPage = asRecord(pages[0]);
    const cid = asNumber(firstPage?.cid) ?? asNumber(view.cid);
    if (!cid) throw new TaskError({ code: "CONTENT_TYPE_UNSUPPORTED", message: "B站视频没有可用的P1信息", action: "edit_input" });
    const playPayload = await getApi(
      http,
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=80&fnval=16&fourk=1`,
      link.finalUrl,
    );
    const playData = asRecord(playPayload.data);
    if (!playData) throw new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "B站播放信息为空", action: "retry" });
    const sources = dashSources(playData, link.finalUrl);
    const owner = asRecord(view.owner);

    return {
      platform: this.platform,
      contentType: "video",
      id: bvid,
      sourceUrl: link.sourceUrl,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      title: asString(view.title),
      description: asString(view.desc),
      author: asString(owner?.name),
      coverUrl: normalizeHttpUrl(view.pic),
      durationSeconds: asNumber(firstPage?.duration) ?? asNumber(view.duration),
      videos: sources.videos,
      audios: sources.audios,
      images: [],
      subtitles: [],
      raw: { view: viewPayload, play: playPayload },
    };
  }
}
