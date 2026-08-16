import { persistableSuccessRaw, platformForHost, TaskError, type HttpClient, type MediaSource, type PlatformAdapter, type PlatformContent, type ResolvedLink } from "@hongtai/core";
import {
  MOBILE_USER_AGENT,
  asArray,
  asNumber,
  asRecord,
  asString,
  contentStateError,
  dedupeMedia,
  extractAssignedJson,
  fetchPage,
  findRecord,
  mediaHeaders,
  normalizeHttpUrl,
} from "../shared";

function extractNoteId(url: string): string | undefined {
  return url.match(/\/(?:explore|note)\/([a-f0-9]+)/i)?.[1]
    ?? url.match(/\/discovery\/item\/([a-f0-9]+)/i)?.[1]
    ?? url.match(/\/user\/profile\/[^/]+\/([a-f0-9]+)/i)?.[1];
}

function extractNote(root: unknown, noteId?: string): Record<string, unknown> | undefined {
  if (!noteId) return undefined;
  return findRecord(root, (record) => {
    const id = asString(record.noteId) ?? asString(record.id);
    const hasMedia = Boolean(asRecord(record.video) || Array.isArray(record.imageList));
    return hasMedia && id === noteId;
  });
}

function xhsVideos(note: Record<string, unknown>, referer: string): MediaSource[] {
  const video = asRecord(note.video);
  if (!video) return [];
  const media = asRecord(video.media);
  const stream = asRecord(media?.stream);
  const headers = mediaHeaders(referer);
  const sources: MediaSource[] = [];

  for (const streamValue of asArray(stream?.h264)) {
    const item = asRecord(streamValue);
    if (!item) continue;
    const urls = [item.masterUrl, ...asArray(item.backupUrls)];
    for (const value of urls) {
      const url = normalizeHttpUrl(value);
      if (!url) continue;
      sources.push({
        kind: "video",
        url,
        quality: asString(item.videoQuality) ?? `${asNumber(item.width) ?? "?"}x${asNumber(item.height) ?? "?"}`,
        codec: "H.264",
        bitrate: asNumber(item.avgBitrate) ?? asNumber(item.bitRate),
        width: asNumber(item.width),
        height: asNumber(item.height),
        hasWatermark: false,
        headers,
      });
    }
  }

  const consumer = asRecord(video.consumer);
  const originKey = asString(video.originVideoKey) ?? asString(consumer?.originVideoKey);
  const direct = normalizeHttpUrl(video.url)
    ?? (originKey ? normalizeHttpUrl(originKey, "https://sns-video-bd.xhscdn.com/") : undefined);
  if (direct) {
    sources.push({ kind: "video", url: direct, quality: "origin", codec: "H.264", hasWatermark: false, headers });
  }
  return dedupeMedia(sources);
}

export class XiaohongshuAdapter implements PlatformAdapter {
  readonly platform = "xiaohongshu" as const;
  readonly supportLevel = "stable" as const;

  matches(url: string): boolean {
    try {
      return platformForHost(new URL(url).hostname) === "xiaohongshu";
    } catch {
      return false;
    }
  }

  async resolve(url: string, http: HttpClient): Promise<ResolvedLink> {
    const response = await fetchPage(http, url, {
      "User-Agent": MOBILE_USER_AGENT,
      Referer: "https://www.xiaohongshu.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    return { sourceUrl: url, finalUrl: response.url, status: response.status, body: response.body };
  }

  async parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent> {
    void http;
    const body = link.body ?? "";
    const state = extractAssignedJson(body, ["window.__INITIAL_STATE__", "__INITIAL_STATE__"]);
    if (!state) throw contentStateError(body, "小红书");
    const noteId = extractNoteId(link.finalUrl);
    const note = extractNote(state, noteId);
    if (!note) throw new TaskError({ code: "CONTENT_PARSE_FAILED", message: "小红书页面数据中没有找到笔记信息", action: "retry" });

    const user = asRecord(note.user);
    const imageSources: MediaSource[] = [];
    for (const imageValue of asArray(note.imageList)) {
      const image = asRecord(imageValue);
      if (!image) continue;
      const url = normalizeHttpUrl(image.urlDefault)
        ?? normalizeHttpUrl(image.urlPre)
        ?? normalizeHttpUrl(image.url);
      if (url) imageSources.push({ kind: "image", url, headers: mediaHeaders(link.finalUrl) });
    }

    const video = asRecord(note.video);
    const durationMs = asNumber(video?.duration) ?? asNumber(asRecord(video?.media)?.duration);
    const videos = xhsVideos(note, link.finalUrl);
    const images = dedupeMedia(imageSources);
    const id = asString(note.noteId) ?? asString(note.id) ?? noteId;
    const title = asString(note.title) ?? asString(note.desc);
    const authorName = asString(user?.nickname) ?? asString(user?.nickName);
    const contentType = videos.length > 0 ? "video" as const : images.length > 0 ? "image_text" as const : "unknown" as const;
    return {
      platform: this.platform,
      contentType,
      id,
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title,
      description: asString(note.desc),
      author: authorName,
      coverUrl: imageSources[0]?.url,
      durationSeconds: durationMs ? durationMs / 1_000 : undefined,
      videos,
      audios: [],
      images,
      subtitles: [],
      raw: persistableSuccessRaw({
        platform: this.platform,
        id,
        contentType,
        httpStatus: link.status,
        hasAuthor: Boolean(authorName),
        hasTitle: Boolean(title),
        videos,
        audios: [],
        images,
      }),
    };
  }
}
