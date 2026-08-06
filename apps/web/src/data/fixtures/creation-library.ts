import type { AssetsViewModel, CreateViewModel, PublishViewModel, SettingsViewModel } from "../visual-types";
import { images, media } from "./media";

export const create: CreateViewModel = {
  source: "design-fixture",
  title: "制作新视频",
  promptLabel: "这次想讲什么？",
  promptPlaceholder: "例如：我们家的产品为什么更安全",
  profileTitle: "我的生意档案已参与生成",
  profileTags: ["全屋定制", "环保E0级", "自有工厂"],
  templateTitle: "选择视频模板",
  templateMoreLabel: "查看全部",
  templates: [
    { id: "safety", title: "安全感型", description: "制作页与生成结果", media: media("安全感视频模板", "sage", images.create, "9 / 16"), selected: true },
    { id: "pain", title: "痛点转化型", description: "从混乱到高效的工作流", media: media("痛点转化视频模板", "teal", images.device, "9 / 16") },
    { id: "brand", title: "品牌故事型", description: "温和可信的品牌表达", media: media("品牌故事视频模板", "warm", images.store, "9 / 16") },
  ],
  materialTitle: "筛选素材来源",
  materialFilters: ["全部", "门店实拍", "产品特写", "客户场景"],
  actionLabel: "一键制作视频",
  generationTitle: "视频生成中...",
  generationDescription: "正在为您调取生意档案，智能匹配安全感模板素材",
  generationEta: "预计还需要 15 秒",
};

export const assets: AssetsViewModel = {
  source: "design-fixture",
  title: "素材库",
  uploadLabel: "上传",
  tabs: ["拆解模板", "我的素材"],
  activeTab: "拆解模板",
  searchPlaceholder: "搜索拆解模板...",
  filters: ["全部模板", "产品介绍", "门店宣传", "技术讲解"],
  templates: [
    { id: "product", title: "3C产品高级感展示模板", tags: ["#产品介绍", "#快节奏"], badge: "TOP CHOICE", badgeTone: "dark", media: media("3C 产品高级感展示", "ink", images.device, "16 / 9") },
    { id: "store", title: "探店门店沉浸式叙事", tags: ["#门店宣传", "#Vlog"], badge: "创意库", badgeTone: "soft", media: media("探店门店沉浸式叙事", "warm", images.store, "16 / 9") },
  ],
  folderTitle: "文件夹",
  folders: ["所有内容", "门店实拍", "产品渲染图"],
  assetTitle: "所有内容",
  assetCount: "12",
  assets: [
    { id: "uploading", title: "门店实拍-春季空间", kind: "uploading", statusLabel: "上传中 65%", media: media("上传中的门店素材", "warm", images.store, "16 / 9") },
    { id: "ready", title: "产品细节-环保板材", kind: "ready", statusLabel: "00:15", media: media("产品细节素材", "forest", images.device, "16 / 9") },
    { id: "failed", title: "客户案例片段", kind: "failed", statusLabel: "处理失败", media: media("处理失败的素材", "sage", images.create, "16 / 9") },
  ],
  emptyTitle: "暂无更多素材",
  emptyDescription: "您上传的所有视频和图片素材将出现在这里",
  emptyAction: "立即上传",
};

export const settings: SettingsViewModel = {
  source: "design-fixture",
  title: "个人中心",
  profileName: "大健康创业者",
  accountType: "账号类型：专业版",
  plan: "PRO",
  avatar: media("用户头像", "sage", images.avatar, "1 / 1"),
  aiConfigTitle: "AI 配置",
  voiceRow: { id: "voice", icon: "record_voice_over", label: "首选配音", value: "温润男声", action: "select" },
  modelTitle: "模型接入设置",
  modelRows: [
    { id: "text-model", icon: "smart_toy", label: "文本模型", value: "GPT-4o", action: "select" },
    { id: "api-key", icon: "key", label: "API Key 配置", value: "sk-••••••••••••••••", action: "masked", disabled: true },
    { id: "base-url", icon: "language", label: "自定义域名/代理", value: "https://api.openai.com/v1", action: "masked", disabled: true },
    { id: "tts", icon: "record_voice_over", label: "TTS 语音合成", value: "OpenAI TTS", action: "select" },
    { id: "asr", icon: "keyboard_voice", label: "语音转写", value: "Whisper-1", action: "select" },
  ],
  generalTitle: "通用",
  generalRows: [
    { id: "feedback", icon: "comment", label: "意见反馈", action: "disclosure" },
    { id: "about", icon: "info", label: "关于我们", action: "disclosure" },
    { id: "version", icon: "update", label: "版本更新", value: "v2.4.0", action: "disclosure" },
  ],
  logoutLabel: "退出登录",
  copyright: "© 2024 宏泰AI智能体 版权所有",
};

export const publish: PublishViewModel = {
  source: "design-fixture",
  title: "视频已生成",
  media: media("生成完成的视频预览", "sage", images.publish, "9 / 16"),
  platformsTitle: "分享至平台",
  platforms: [
    { id: "douyin", label: "抖音", icon: "share" },
    { id: "kuaishou", label: "快手", icon: "movie" },
    { id: "wechat-channel", label: "视频号", icon: "video_library" },
    { id: "wechat", label: "微信好友", icon: "comment" },
  ],
  hint: "点击将跳转至对应应用进行发布",
  primaryAction: "保存并去发布",
  secondaryActions: ["查看记录", "继续制作"],
};
