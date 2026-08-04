import { TaskError, issueFromError } from "./errors";
import type { InputInspection, NormalizedInput, SupportedPlatform } from "./models";

const SUPPORTED_LINK = /(^|[^\p{L}\p{N}@._-])((?:https?:\/\/)?(?:www\.)?(?:douyin\.com|v\.douyin\.com|iesdouyin\.com|xiaohongshu\.com|xhslink\.com|xhslink\.cn|bilibili\.com|b23\.tv)(?:\/[^\s<>"'，。！？；：、）》】」』]*)?)/giu;
const TRAILING_PUNCTUATION = /[，。！？；：、）》】」』,.!?;:]+$/u;

function platformForHost(hostname: string): SupportedPlatform | undefined {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host === "douyin.com" || host === "v.douyin.com" || host === "iesdouyin.com") return "douyin";
  if (host === "xiaohongshu.com" || host === "xhslink.com" || host === "xhslink.cn") return "xiaohongshu";
  if (host === "bilibili.com" || host === "b23.tv") return "bilibili";
  return undefined;
}

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
    return { extractedText, normalizedUrl: parsed.toString(), platform };
  } catch {
    return undefined;
  }
}

export function normalizeInput(rawInput: string): NormalizedInput {
  if (!rawInput.trim()) {
    throw new TaskError({
      code: "INPUT_EMPTY",
      message: "请粘贴抖音、小红书或B站的分享内容",
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
      message: "没有找到受支持的抖音、小红书或B站链接",
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
