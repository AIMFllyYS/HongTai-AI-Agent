import { BilibiliAdapter } from "./bilibili/adapter";
import { DouyinAdapter } from "./douyin/adapter";
import { PlatformRegistry } from "./registry";
import { XiaohongshuAdapter } from "./xiaohongshu/adapter";

export * from "./bilibili/adapter";
export * from "./douyin/adapter";
export * from "./registry";
export * from "./shared";
export * from "./xiaohongshu/adapter";

export const platformRegistry = new PlatformRegistry([
  new DouyinAdapter(),
  new XiaohongshuAdapter(),
  new BilibiliAdapter(),
]);

