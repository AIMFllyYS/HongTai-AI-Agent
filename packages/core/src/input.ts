import { TaskError, issueFromError } from "./errors";
import type { InputInspection, NormalizedInput } from "./models";
import { platformForHost, supportedLinkHostPattern } from "./platform-hosts";

const SUPPORTED_LINK = new RegExp(
  String.raw`(^|[^\p{L}\p{N}@._-])((?:https?:\/\/)?(?:www\.)?(?:${supportedLinkHostPattern()})(?:\/[^\s<>"'，。！？；：、）》】」』]*)?)`,
  "giu",
);
const TRAILING_PUNCTUATION = /[，。！？；：、）》】」』,.!?;:]+$/u;

function normalizeCandidate(candidate: string): Omit<NormalizedInput, "rawInput" | "ignoredSupportedUrlCount"> | undefined {
  const extractedText = candidate.replace(TRAILING_PUNCTUATION, "");
  const withScheme = /^https?:\/\//i.test(extractedText) ? extractedText : `https://${extractedText}`;
  try {
    const parsed = new URL(withScheme);
    parsed.protocol = "https:";
    parsed.username = "";
    parsed.password = "";
    const platform = platformForHost(parsed.hostname);
    if (!platform) return undefined;
    if (platform === "kuaishou") {
      const host = parsed.hostname.toLowerCase();
      const supportedPath = host === "v.kuaishou.com"
        ? /^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)
        : host === "www.kuaishou.com" && /^\/short-video\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
      if (!supportedPath) return undefined;
    }
    return { extractedText, normalizedUrl: parsed.toString(), platform };
  } catch {
    return undefined;
  }
}

export function normalizeInput(rawInput: string): NormalizedInput {
  if (!rawInput.trim()) {
    throw new TaskError({
      code: "INPUT_EMPTY",
      message: "请粘贴抖音、小红书、B站或快手的分享内容",
      action: "edit_input",
    });
  }

  const valid: Omit<NormalizedInput, "rawInput" | "ignoredSupportedUrlCount">[] = [];
  for (const match of rawInput.matchAll(SUPPORTED_LINK)) {
    const normalized = normalizeCandidate(match[2] ?? "");
    if (normalized) valid.push(normalized);
  }
  const first = valid[0];
  if (!first) {
    throw new TaskError({
      code: "INPUT_NO_SUPPORTED_URL",
      message: "没有找到受支持的抖音、小红书、B站或快手链接",
      action: "edit_input",
    });
  }
  return {
    rawInput,
    ...first,
    ignoredSupportedUrlCount: Math.max(0, valid.length - 1),
  };
}

export function inspectInput(rawInput: string): InputInspection {
  try {
    return { ok: true, value: normalizeInput(rawInput) };
  } catch (error) {
    return { ok: false, issue: issueFromError(error, "detect-platform") };
  }
}
