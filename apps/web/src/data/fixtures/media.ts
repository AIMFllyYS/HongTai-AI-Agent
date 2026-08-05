import type { RecentAnalysis, VisualMedia } from "../visual-types";

export const images = {
  workwear: "/media/workwear.jpg",
  food: "/media/food.jpg",
  device: "/media/device.jpg",
  store: "/media/store.jpg",
  publish: "/media/publish.jpg",
  create: "/media/create.jpg",
  face: "/media/face.jpg",
  tongue: "/media/tongue.jpg",
  avatar: "/media/avatar.jpg",
} as const;

export const media = (alt: string, tone: VisualMedia["tone"], src?: string, aspectRatio?: string): VisualMedia => ({
  alt,
  tone,
  src,
  aspectRatio,
});

export const recent: readonly RecentAnalysis[] = [
  {
    id: "workwear",
    title: "职场穿搭爆款逻辑拆解",
    updatedAt: "2023-11-24 14:30",
    status: "completed",
    statusLabel: "已完成",
    platform: "douyin",
    media: media("职场穿搭视频封面", "sage", images.workwear, "4 / 5"),
  },
  {
    id: "food",
    title: "美食探店类脚本深度分析",
    updatedAt: "2023-11-23 09:15",
    status: "processing",
    statusLabel: "分析中",
    platform: "xiaohongshu",
    media: media("美食探店视频封面", "warm", images.food, "4 / 5"),
  },
  {
    id: "device",
    title: "数码测评开头3秒抓人技巧",
    updatedAt: "2023-11-22 18:45",
    status: "completed",
    statusLabel: "已完成",
    platform: "bilibili",
    media: media("数码测评视频封面", "forest", images.device, "4 / 5"),
  },
];

export const timeline = [
  {
    id: "hook",
    label: "钩子 (Hook)",
    timeRange: "00:00 - 00:05",
    tone: "primary" as const,
    description: "兄弟们，不想多说了，给我使劲蹬codex。强调强烈推荐，制造悬念。",
    tags: ["痛点共鸣", "利益点前置"],
  },
  {
    id: "value",
    label: "痛点/价值 (Value)",
    timeRange: "00:05 - 00:12",
    tone: "accent" as const,
    description: "点出目标受众（开发的朋友），抛出生产力神器的定位。",
  },
  {
    id: "body",
    label: "正文/干货 (Body)",
    timeRange: "00:12 - 03:30",
    tone: "neutral" as const,
    description: "手把手工作流配置教学（具体步骤略，见原始文稿）。",
  },
  {
    id: "cta",
    label: "行动呼吁 (CTA)",
    timeRange: "03:30 - 03:42",
    tone: "error" as const,
    description: "引导点赞收藏，评论区领取配置清单。",
  },
];
