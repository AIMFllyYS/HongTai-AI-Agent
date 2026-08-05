import type { PlatformAdapter, SupportedPlatform } from "@hongtai/core";

const PLATFORM_NAMES: Readonly<Record<SupportedPlatform, string>> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
};

export function experimentalPlatformNotice(
  adapter: Pick<PlatformAdapter, "platform" | "supportLevel">,
): string | undefined {
  if (adapter.supportLevel !== "experimental") return undefined;
  return `提示：${PLATFORM_NAMES[adapter.platform]}（实验性）仅支持匿名公开单条视频，链路可能受平台风控影响。`;
}
