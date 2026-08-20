import type { AnalysisResultViewModel, DetailViewModel } from "../visual-types";
import { images, media, timeline } from "./media";

export const analysisResult: AnalysisResultViewModel = {
  source: "design-fixture",
  title: "AI工具革命：如何重构你的每日工作流",
  media: media("AI 工作流视频封面", "forest", images.device, "16 / 9"),
  duration: "12:45",
  viewCount: "1.2w 完播",
  tabs: ["爆款结构", "文字稿", "模板库"],
  activeTab: "爆款结构",
  intro: "如果你还在手动整理会议纪要，你每天至少浪费了2小时。今天我要教你一个AI神技...",
  timeline: [
    {
      id: "result-hook",
      label: "开场钩子",
      timeRange: "00:00 - 00:15",
      tone: "accent",
      description: "如果你还在手动整理会议纪要，你每天至少浪费了2小时。今天我要教你一个AI神技...",
      tags: ["痛点共鸣", "利益点前置"],
    },
    {
      id: "result-pain",
      label: "痛点铺垫",
      timeRange: "00:15 - 01:20",
      tone: "neutral",
      description: "详细拆解了传统流程的低效，列举了职场人最怕的三个瞬间，建立紧迫感。",
    },
    {
      id: "result-body",
      label: "核心论证",
      timeRange: "01:20 - 08:30",
      tone: "primary",
      description: "工具矩阵选择（轻量化原则）\nPrompt 三步法实操演示",
    },
  ],
  templateTitle: "职场效率工具拆解模板",
  templateDescription: "适配场景：知识科普/技能分享 · 结构强度：逻辑严密型",
  templateMeta: [
    { label: "适配场景", value: "知识科普/技能分享" },
    { label: "结构强度", value: "逻辑严密型" },
  ],
  templateAction: "用此模板制作",
  saveAction: "保存模板",
  retryAction: "重新拆解",
};

export const videoDetail: DetailViewModel = {
  source: "design-fixture",
  variant: "video",
  title: "拆解详情",
  contentTitle: "兄弟们，不想多说了，给我使劲蹬codex...",
  author: "阿宇哥AI学伴",
  duration: "03:42",
  platformLabel: "视频",
  statusLabel: "已完成",
  media: media("代码工作流视频封面", "ink", images.workwear, "16 / 9"),
  metrics: [
    { icon: "heart", label: "点赞", value: "42" },
    { icon: "bookmark", label: "收藏", value: "19" },
    { icon: "comment", label: "评论", value: "16" },
    { icon: "share", label: "分享", value: "-" },
  ],
  tabs: ["原始文稿", "AI 拆解"],
  activeTab: "AI 拆解",
  transcript: [
    { time: "00:00", text: "兄弟们，不想多说了，给我使劲蹬codex。" },
    { time: "00:05", text: "这个工具简直是生产力神器，特别是做开发的朋友。" },
    { time: "00:12", text: "今天手把手教大家怎么配置工作流，把效率拉满。" },
    { time: "00:20", text: "首先，我们需要准备好环境..." },
  ],
  analysisIntro: "AI 已将原始视频文稿重构为标准脚本结构，便于后续复用。",
  timeline,
  tags: ["#codex", "#workbuddy教程", "#效率工具", "#AI编程"],
};

export const galleryDetail: DetailViewModel = {
  ...videoDetail,
  variant: "gallery",
  contentTitle: "健康养生干货分享",
  platformLabel: "视频",
  media: media("健康养生视频封面", "warm", images.workwear, "16 / 9"),
  gallery: {
    title: "素材预览",
    countLabel: "4张图片",
    sizeLabel: "2.4MB",
    durationLabel: "1.2s",
    saveLabel: "保存全部",
    media: media("牛油果早餐图文素材", "warm", images.food, "4 / 3"),
  },
  tags: ["#健康", "#养生", "#AI拆解"],
};
