import type { SupportedPlatform } from "./models";

/** Exact hosts only. `www.` is stripped at lookup except when the key itself includes it. */
export const SUPPORTED_PLATFORM_HOSTS: Readonly<Record<string, SupportedPlatform>> = {
  "douyin.com": "douyin",
  "v.douyin.com": "douyin",
  "m.douyin.com": "douyin",
  "iesdouyin.com": "douyin",
  "xiaohongshu.com": "xiaohongshu",
  "m.xiaohongshu.com": "xiaohongshu",
  "xhslink.com": "xiaohongshu",
  "xhslink.cn": "xiaohongshu",
  "bilibili.com": "bilibili",
  "m.bilibili.com": "bilibili",
  "b23.tv": "bilibili",
  "www.kuaishou.com": "kuaishou",
  "v.kuaishou.com": "kuaishou",
};

export function platformForHost(hostname: string): SupportedPlatform | undefined {
  const rawHost = hostname.toLowerCase();
  return SUPPORTED_PLATFORM_HOSTS[rawHost] ?? SUPPORTED_PLATFORM_HOSTS[rawHost.replace(/^www\./, "")];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function supportedLinkHostPattern(): string {
  const hosts = [...new Set(
    Object.keys(SUPPORTED_PLATFORM_HOSTS).map((host) => host.replace(/^www\./, "")),
  )].sort((left, right) => right.length - left.length);
  return hosts.map(escapeRegExp).join("|");
}
