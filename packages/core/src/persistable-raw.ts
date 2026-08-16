import type { ContentType, PlatformContent, SupportedPlatform } from "./models";

export interface PersistableMediaCandidate {
  readonly host: string;
  readonly path: string;
}

const EXTRA_SCALAR_KEYS = [
  "operationName",
  "status",
  "type",
  "hasPhoto",
  "graphqlErrorCount",
  "errorClassification",
] as const;

const EXTRA_MEDIA_SCALAR_KEYS = ["mp4Count", "hlsCount"] as const;

export interface PersistableSuccessRawInput {
  readonly platform: SupportedPlatform;
  readonly id?: string;
  readonly contentType: ContentType;
  readonly httpStatus?: number;
  readonly hasAuthor: boolean;
  readonly hasTitle: boolean;
  readonly videos: readonly { readonly url: string }[];
  readonly audios: readonly { readonly url: string }[];
  readonly images: readonly { readonly url: string }[];
  readonly extras?: {
    readonly operationName?: string | number | boolean;
    readonly status?: string | number | boolean;
    readonly type?: string | number | boolean;
    readonly hasPhoto?: string | number | boolean;
    readonly graphqlErrorCount?: string | number | boolean;
    readonly errorClassification?: string | number | boolean;
    readonly mp4Count?: string | number | boolean;
    readonly hlsCount?: string | number | boolean;
    readonly extraCandidates?: readonly PersistableMediaCandidate[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistableScalar(value: unknown): string | number | boolean | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
}

export function persistableHostPath(value: string): PersistableMediaCandidate | undefined {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || parsed.hostname.includes("?") || parsed.hostname.includes("#")) return undefined;
    if (!parsed.pathname.startsWith("/") || parsed.pathname.includes("?") || parsed.pathname.includes("#")) {
      return undefined;
    }
    return { host: parsed.hostname, path: parsed.pathname };
  } catch {
    return undefined;
  }
}

function persistableCandidate(value: unknown): PersistableMediaCandidate | undefined {
  if (!isRecord(value) || typeof value.host !== "string" || typeof value.path !== "string") return undefined;
  if (!value.host || value.host.includes("/") || value.host.includes("?") || value.host.includes("#")) {
    return undefined;
  }
  if (!value.path.startsWith("/") || value.path.includes("?") || value.path.includes("#")) return undefined;
  return { host: value.host, path: value.path };
}

function persistableCandidates(value: unknown): PersistableMediaCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const candidate = persistableCandidate(item);
    return candidate ? [candidate] : [];
  });
}

function candidatesFromUrls(urls: readonly string[]): PersistableMediaCandidate[] {
  return urls.flatMap((url) => {
    const candidate = persistableHostPath(url);
    return candidate ? [candidate] : [];
  });
}

function mergeCandidates(...groups: readonly PersistableMediaCandidate[][]): PersistableMediaCandidate[] {
  const seen = new Set<string>();
  const merged: PersistableMediaCandidate[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const key = `${candidate.host}\0${candidate.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}

function assignedScalars(
  source: object | undefined,
  keys: readonly string[],
): Record<string, string | number | boolean> {
  const assigned: Record<string, string | number | boolean> = {};
  if (!source) return assigned;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = persistableScalar(record[key]);
    if (value !== undefined) assigned[key] = value;
  }
  return assigned;
}

export function persistableSuccessRaw(input: PersistableSuccessRawInput): Record<string, unknown> {
  const extras = assignedScalars(input.extras, EXTRA_SCALAR_KEYS);
  const mediaExtras = assignedScalars(input.extras, EXTRA_MEDIA_SCALAR_KEYS);
  const projection: Record<string, unknown> = {
    platform: input.platform,
    contentType: input.contentType,
    hasAuthor: input.hasAuthor,
    hasTitle: input.hasTitle,
    ...extras,
    media: {
      videoCount: input.videos.length,
      audioCount: input.audios.length,
      imageCount: input.images.length,
      ...mediaExtras,
      candidates: mergeCandidates(
        candidatesFromUrls(input.videos.map((source) => source.url)),
        candidatesFromUrls(input.audios.map((source) => source.url)),
        candidatesFromUrls(input.images.map((source) => source.url)),
        persistableCandidates(input.extras?.extraCandidates),
      ),
    },
  };
  if (input.id) projection.id = input.id;
  if (typeof input.httpStatus === "number") projection.httpStatus = input.httpStatus;
  return projection;
}

export function persistableSuccessRawFromContent(
  content: PlatformContent,
  httpStatus?: number,
): Record<string, unknown> {
  const raw = isRecord(content.raw) ? content.raw : undefined;
  const media = isRecord(raw?.media) ? raw.media : undefined;
  const rawStatus = persistableScalar(raw?.httpStatus);
  return persistableSuccessRaw({
    platform: content.platform,
    id: content.id,
    contentType: content.contentType,
    httpStatus: typeof httpStatus === "number"
      ? httpStatus
      : typeof rawStatus === "number" ? rawStatus : undefined,
    hasAuthor: Boolean(content.author),
    hasTitle: Boolean(content.title),
    videos: content.videos,
    audios: content.audios,
    images: content.images,
    extras: {
      ...assignedScalars(raw, EXTRA_SCALAR_KEYS),
      ...assignedScalars(media, EXTRA_MEDIA_SCALAR_KEYS),
      extraCandidates: persistableCandidates(media?.candidates),
    },
  });
}
