import { persistableHostPath, persistableSuccessRaw, type MediaSource } from "@hongtai/core";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  dedupeMedia,
  mediaHeaders,
  normalizeHttpUrl,
} from "../shared";
import { KUAISHOU_OPERATION_NAME, type KuaishouDetailResult } from "./client";

export interface ParsedKuaishouDetail {
  readonly id?: string;
  readonly title?: string;
  readonly author?: string;
  readonly coverUrl?: string;
  readonly durationSeconds?: number;
  readonly videos: readonly MediaSource[];
  readonly raw: unknown;
}

function mediaKind(value: string): "mp4" | "hls" | undefined {
  try {
    const path = new URL(value).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "mp4";
    if (path.endsWith(".m3u8")) return "hls";
  } catch {
    return undefined;
  }
  return undefined;
}

function manifestCandidates(photo: Record<string, unknown>, referer: string): {
  readonly mp4: MediaSource[];
  readonly urls: string[];
} {
  const manifest = asRecord(photo.manifest);
  const mp4: MediaSource[] = [];
  const urls: string[] = [];
  for (const setValue of asArray(manifest?.adaptationSet)) {
    const set = asRecord(setValue);
    for (const representationValue of asArray(set?.representation)) {
      const representation = asRecord(representationValue);
      const url = normalizeHttpUrl(representation?.url);
      if (!url) continue;
      urls.push(url);
      if (mediaKind(url) !== "mp4") continue;
      mp4.push({
        kind: "video",
        url,
        quality: asString(representation?.qualityType),
        codec: asString(representation?.codecs),
        mimeType: "video/mp4",
        bitrate: asNumber(representation?.avgBitrate),
        width: asNumber(representation?.width),
        height: asNumber(representation?.height),
        headers: mediaHeaders(referer),
      });
    }
  }
  return { mp4: dedupeMedia(mp4), urls };
}

export function parseKuaishouDetail(result: KuaishouDetailResult, referer: string): ParsedKuaishouDetail {
  const author = asRecord(result.detail.author);
  const photo = asRecord(result.detail.photo) ?? {};
  const directUrl = normalizeHttpUrl(photo.photoUrl);
  const manifest = manifestCandidates(photo, referer);
  const direct = directUrl && mediaKind(directUrl) === "mp4"
    ? [{ kind: "video" as const, url: directUrl, quality: "source", mimeType: "video/mp4", headers: mediaHeaders(referer) }]
    : [];
  const videos = direct.length > 0 ? direct : manifest.mp4;
  const candidateUrls = [directUrl, ...manifest.urls].filter((value): value is string => Boolean(value));
  const mp4Count = candidateUrls.filter((url) => mediaKind(url) === "mp4").length;
  const hlsCount = candidateUrls.filter((url) => mediaKind(url) === "hls").length;
  const durationMs = asNumber(photo.duration);
  const id = asString(photo.id);
  const title = asString(photo.caption);
  const authorName = asString(author?.name);

  return {
    id,
    title,
    author: authorName,
    coverUrl: normalizeHttpUrl(photo.coverUrl),
    durationSeconds: durationMs == null ? undefined : durationMs / 1_000,
    videos,
    raw: persistableSuccessRaw({
      platform: "kuaishou",
      id,
      contentType: "video",
      httpStatus: result.httpStatus,
      hasAuthor: Boolean(authorName),
      hasTitle: Boolean(title),
      videos,
      audios: [],
      images: [],
      extras: {
        operationName: KUAISHOU_OPERATION_NAME,
        status: asNumber(result.detail.status) ?? asString(result.detail.status),
        type: asNumber(result.detail.type) ?? asString(result.detail.type),
        hasPhoto: Boolean(result.detail.photo),
        graphqlErrorCount: result.graphqlErrorCount,
        errorClassification: "none",
        mp4Count,
        hlsCount,
        extraCandidates: candidateUrls.flatMap((url) => {
          const safe = persistableHostPath(url);
          return safe ? [safe] : [];
        }),
      },
    }),
  };
}
