import { TaskError, type HttpClient, type PlatformAdapter, type PlatformContent, type ResolvedLink } from "@hongtai/core";
import { DESKTOP_USER_AGENT, fetchPage } from "../shared";
import { fetchKuaishouDetail } from "./client";
import { parseKuaishouDetail } from "./parser";

const INPUT_HOST = /^(?:www|v)\.kuaishou\.com$/i;
const RESOLVED_HOSTS = new Set(["www.kuaishou.com", "v.kuaishou.com", "v.m.chenzhongtech.com"]);

function extractPhotoId(value: string): string | undefined {
  return value.match(/\/(?:short-video|fw\/photo)\/([A-Za-z0-9_-]+)/)?.[1];
}

export class KuaishouAdapter implements PlatformAdapter {
  readonly platform = "kuaishou" as const;
  readonly supportLevel = "experimental" as const;

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (!INPUT_HOST.test(parsed.hostname)) return false;
      const host = parsed.hostname.toLowerCase();
      return host === "v.kuaishou.com"
        ? /^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)
        : host === "www.kuaishou.com" && /^\/short-video\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  async resolve(url: string, http: HttpClient): Promise<ResolvedLink> {
    const response = await fetchPage(http, url, {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: "https://www.kuaishou.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    let finalHost = "";
    try {
      finalHost = new URL(response.url).hostname.toLowerCase();
    } catch (error) {
      throw new TaskError({ code: "LINK_REDIRECT_INVALID", message: "快手返回了无效作品地址", action: "edit_input", cause: error });
    }
    if (!RESOLVED_HOSTS.has(finalHost)) {
      throw new TaskError({ code: "LINK_REDIRECT_INVALID", message: "快手链接跳转到了未认可的地址", action: "edit_input", details: { hostname: finalHost } });
    }
    const photoId = extractPhotoId(response.url) ?? extractPhotoId(response.body);
    if (!photoId) throw new TaskError({ code: "INPUT_URL_INVALID", message: "无法从快手链接中提取作品ID", action: "edit_input" });
    return {
      sourceUrl: url,
      finalUrl: `https://www.kuaishou.com/short-video/${encodeURIComponent(photoId)}`,
      status: response.status,
    };
  }

  async parse(link: ResolvedLink, http: HttpClient): Promise<PlatformContent> {
    const photoId = extractPhotoId(link.finalUrl) ?? extractPhotoId(link.body ?? "");
    if (!photoId) throw new TaskError({ code: "INPUT_URL_INVALID", message: "无法从快手链接中提取作品ID", action: "edit_input" });
    const parsed = parseKuaishouDetail(await fetchKuaishouDetail(http, photoId, link.finalUrl), link.finalUrl);
    return {
      platform: this.platform,
      contentType: "video",
      id: parsed.id ?? photoId,
      sourceUrl: link.sourceUrl,
      canonicalUrl: link.finalUrl,
      title: parsed.title,
      description: parsed.title,
      author: parsed.author,
      coverUrl: parsed.coverUrl,
      durationSeconds: parsed.durationSeconds,
      videos: parsed.videos,
      audios: [],
      images: [],
      subtitles: [],
      raw: parsed.raw,
    };
  }
}
