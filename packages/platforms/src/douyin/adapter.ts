import type {
  HttpClient,
  MediaSource,
  PlatformAdapter,
  PlatformContent,
  ResolvedLink,
} from "@hongtai/core";
import {
  DESKTOP_USER_AGENT,
  asArray,
  asNumber,
  asRecord,
  asString,
  dedupeMedia,
  extractAssignedJson,
  fetchPage,
  findRecord,
  firstString,
  mediaHeaders,
  normalizeHttpUrl,
} from "../shared";

const DOUYIN_HOST = /(^|\.)(douyin\.com|iesdouyin\.com)$/i;

function extractAwemeId(url: string): string | undefined {
  const match = url.match(/\/(?:video|note)\/(\d+)/) ?? url.match(/[?&]modal_id=(\d+)/);
  return match?.[1];
}

function extractItem(root: unknown, awemeId?: string): Record<string, unknown> | undefined {
  return findRecord(root, (record) => {
    const id = asString(record.aweme_id);
    if (awemeId && id === awemeId) return true;
    return Boolean(id && (asRecord(record.video) || Array.isArray(record.images)));
  });
}

function videoSources(item: Record<string, unknown>, referer: string): MediaSource[] {
  const video = asRecord(item.video);
  if (!video) return [];
  const sources: MediaSource[] = [];
  const headers = mediaHeaders(referer);

  const addPlayAddress = (addressValue: unknown, quality?: string, bitrate?: number): void => {
    const address = asRecord(addressValue);
    if (!address) return;
    const uri = asString(address.uri);
    if (uri) {
      sources.push({
        kind: "video",
        url: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=${encodeURIComponent(quality || "1080p")}&line=0`,
        quality,
        bitrate,
        codec: "H.264",
        hasWatermark: false,
        headers,
      });
    }
    for (const candidate of asArray(address.url_list)) {
      const url = normalizeHttpUrl(candidate);
      if (!url) continue;
      const normalized = url.replace("/playwm/", "/play/");
      sources.push({
        kind: "video",
        url: normalized,
        quality,
        bitrate,
        codec: "H.264",
        hasWatermark: !normalized.includes("/play/"),
        headers,
      });
    }
  };

  for (const rateValue of asArray(video.bit_rate)) {
    const rate = asRecord(rateValue);
    if (!rate) continue;
    const quality = asString(rate.gear_name) ?? asString(rate.quality_type) ?? asString(rate.HDR_type);
    addPlayAddress(rate.play_addr ?? rate.play_addr_h264, quality, asNumber(rate.bit_rate));
  }
  addPlayAddress(video.play_addr_h264 ?? video.play_addr, "default");
  return dedupeMedia(sources);
}

export class DouyinAdapter implements PlatformAdapter {
  readonly platform = "douyin" as const;

  matches(url: string): boolean {
    try {
      return DOUYIN_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  async resolve(url: string, http: HttpClient): Promise<ResolvedLink> {
    const response = await fetchPage(http, url, {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: "https://www.douyin.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    return { sourceUrl: url, finalUrl: response.url, status: response.status, body: response.body };
  }

  async parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent> {
    const awemeId = extractAwemeId(link.finalUrl);
    let body = link.body ?? "";
    let routerData = extractAssignedJson(body, ["window._ROUTER_DATA", "_ROUTER_DATA"]);

    if (!routerData && awemeId) {
      const kind = link.finalUrl.includes("/note/") ? "note" : "video";
      const shareUrl = `https://www.iesdouyin.com/share/${kind}/${awemeId}/`;
      const share = await fetchPage(http, shareUrl, {
        "User-Agent": DESKTOP_USER_AGENT,
        Referer: link.finalUrl,
        Accept: "text/html,application/xhtml+xml",
      });
      body = share.body;
      routerData = extractAssignedJson(body, ["window._ROUTER_DATA", "_ROUTER_DATA"]);
    }

    if (!routerData) throw new Error("抖音公开页面中没有找到 _ROUTER_DATA");
    const item = extractItem(routerData, awemeId);
    if (!item) throw new Error("抖音页面数据中没有找到作品信息");

    const author = asRecord(item.author);
    const video = asRecord(item.video);
    const cover = asRecord(video?.cover);
    const sources = videoSources(item, link.finalUrl);
    const durationMs = asNumber(video?.duration);

    return {
      platform: this.platform,
      id: asString(item.aweme_id) ?? awemeId,
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: asString(item.desc),
      description: asString(item.desc),
      author: asString(author?.nickname),
      coverUrl: normalizeHttpUrl(firstString(cover?.url_list)),
      durationSeconds: durationMs ? durationMs / 1_000 : undefined,
      videos: sources,
      audios: [],
      images: [],
      subtitles: [],
      raw: { item },
    };
  }
}

