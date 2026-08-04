import type { VisualDataAdapter } from "./visual-adapter";
import type {
  AnalysisResultViewModel,
  AssetsViewModel,
  CreateViewModel,
  DetailViewModel,
  HomeViewModel,
  ProcessingViewModel,
  PublishViewModel,
  SettingsViewModel,
  VitalityResultViewModel,
  VitalityScanViewModel,
  VisualMedia,
} from "./visual-types";

const images = {
  workwear:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDHF7BaeMhupCCyu5GSuhOyUDpjpWOK4BsVMcBY-bdG86N2nrDXZ6jIiA1hXB_2ASg0pLMtcocFI5c61Q8UJVrud0f68AtSHAHht4N-LLiVqm0O5S9uCfvRnMGG9E0MJBvnXDsJwQWiXSB2pYff3IGTrwjKDR3ZimohmgT6dMYzXXTeTMQM4V0QT2DQ6-ao06l6P6KmLdqKritEmKHcLN4oirVSfd8lxCxq_8we4PA2RlBzrdTzGXob",
  food:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCr7V0UK5T_m-VPx7zpoD1PkWgx2ET6XKKhLype2Q9tVpe6zUxB3jJJabpHtZ2ZGPTg1F5XUrWBV8o4XHyAvLAZSmrbh516LDOuCJ_cvMtZTO4FOX-WlPGnG_pz4nelLQDba0q9MqLRGhQcko8crgBBrQD3KhnyBIHmGIlSGyBXdDcZYZUlOHCsq73nAtBU3d8USMlNbyV7NzVlKlDJ-6AU4PEGMsm15l1PQ8ebqclqQIatQ68PH1oU",
  device:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuC7dbE1uSVOsNFmWIt7BFp6N7TFr8dwYGH4O5kOeaWJv5c_KVQR2NEO9-S6Sh1TB7jW3_NzVHwfXHGogh1HH3-HJndzJYSNkAUoVRxygZoJ26HXZtJ_Kt4ZML3aCwemaL368v8EQkds3DVBofE6utBm6QdMYkEsxuSfcgplbjWI-mmoAl1_hErbFWrA4pl-Kv8udD1brKUlq1dMsusm8T-YpIsrqC2RHwrvuFadw9Uw4vfTUwt0PUlG",
  store:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBUeVc5YsjTagWHa-46EoQj-mxwH8NJlK3HInN_UX6dmrWEls2EPHNo1hL8TanKh8Q1D3zdWjrFPNIMPrgX6JS5_3-4RUIQpkQ7F5ZWZyTtr6UgIXvCTtrgwF1s0QV7qBGCroGQI93fp-MYRFk2OtAWvY7mOioVYtBiKGhLn3lSqr10ZpjgsUNKl_O3zSqMB1f8w5nGM0tpiUoUyb9orLIz6GoJoKykPCjcuaSR9s34VB42EoqtiC_t",
  publish:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCzMzudGa5euHDtyUv3q0zEp46JDH0iyrIaWh86Zd3iLqwQAKMWenxbiHp-R4_Af1OXj8ujhMqk286HAgsYHJ-a0YWSOsc9mYhhQG-dJX6i4zGlAh-WPVNiaKB4odAHD2k3NZXpKV6WsLUI_-Hz0yNgdgZKW4gOXyckdOizspq34wdiNbODjESkUPRe1GyukkR9N-XN-3jkQghxGPb2r_bJDXrlSxliU9sgTwHjBtP9b6Y9cil00R5Q",
  create:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDqChGl3VIRsSOn4MRQckbzZ0tbI9Eyw0GZ4xAijRWeoF8uvcgbOeogjGd_p6mg5y6s_k6ZfF55pxG92GQd7nITsMSc3ZVn7yy4ZU_B0phJ6H1yREwX0vSUEN5apF1EE8wQITuj70jlfSA5DyAn19oPMQXrE5vtagEx-FQyM1iZdUCsLEQPgoSUO0zkDELyFD1uH4lIZX0xw5nGM0tpiUoUyb9orLIz6GoJoKykPCjcuaSR9s34VB42EoqtiC_t",
  face:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDKAUYqt68vdUFLg-ym5Jnq6JaGbbNRAIkMj-oTh9yxdc1wIG9JiwRMWjqYoC-zErEKmiq0nVjIpw75nYLPWA_TJJwmZ3EJ56hGiVAGUUmY-sUkLU_RvrqSi9bljSTWyY9e3gi_PVkuHg2HxFrRV-tfD9HXHkVUxGM-SdvJKxOnIMU6tRKFaXpCUbKX5H7aNzlJp8XrNaNHEm6PVD9ZyrH3uwa6v9c9uSnajrkg3R_LUQynd_QCM",
  tongue:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCS1wSeX1NTF2abwJMG_zTRppQvHefW2WFaxN2g_XebnZEyJvfHQYHczlUTriAeQ0u95nMCWZ4clP5dTFtrRHdz3nNUkgHsZa5HP47qKm4A1tL1-ITxxg0r6vj16D9wZ346QpnBz_flg0eX4cc2SwlI2XAlOIIVlazMONgCDus09622HXXIdSR9Rs9JVU_oWGB7sGU1WTgNCKyklCMF9j0tlMCzvvHnNlE9UfHRaY1IB73XwvbqnTq0",
  avatar:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAJSOJAQK302TJ91Uy9YlS62-GBamDLMRhjhsUVLS0e1Lwk9dyax_gqlGmdbvAXrPVAXHAwAtc7Qjkdj0-wV3I_cq5Du_HjaBCE9dNzJJG-jWY-lSEyFWtvAYCJej3nln3UXj6cXox__n_5b3Sn7tW7psOikOb40vQ4iI14y-CDijMA24G10zVFIW2V6F2pejFTvVbzpCfP44jvMu5pd0dCtPN4JBUqkNs8jMOVTa8wl_dIRcbz-ITC",
} as const;

const media = (alt: string, tone: VisualMedia["tone"], src?: string, aspectRatio?: string): VisualMedia => ({
  alt,
  tone,
  src,
  aspectRatio,
});

const recent = [
  {
    id: "workwear",
    title: "职场穿搭爆款逻辑拆解",
    updatedAt: "2023-11-24 14:30",
    status: "completed" as const,
    statusLabel: "已完成",
    platform: "douyin" as const,
    media: media("职场穿搭视频封面", "sage", images.workwear, "4 / 5"),
  },
  {
    id: "food",
    title: "美食探店类脚本深度分析",
    updatedAt: "2023-11-23 09:15",
    status: "processing" as const,
    statusLabel: "分析中",
    platform: "xiaohongshu" as const,
    media: media("美食探店视频封面", "warm", images.food, "4 / 5"),
  },
  {
    id: "device",
    title: "数码测评开头3秒抓人技巧",
    updatedAt: "2023-11-22 18:45",
    status: "completed" as const,
    statusLabel: "已完成",
    platform: "bilibili" as const,
    media: media("数码测评视频封面", "forest", images.device, "4 / 5"),
  },
];

const timeline = [
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

const home: HomeViewModel = {
  source: "design-fixture",
  title: "今天想拆解哪条爆款？",
  subtitle: "让 AI 助你洞察爆款逻辑",
  inputTitle: "粘贴参考视频链接",
  inputPlaceholder: "https://v.douyin.com/...",
  inputHint: "请确保链接合法且遵循平台合规提示，支持主流短视频平台。",
  primaryActionLabel: "开始拆解",
  capabilities: [
    { id: "extract", title: "提取视频信息", icon: "video_file", tone: "mint" },
    { id: "transcribe", title: "语音转文字", icon: "keyboard_voice", tone: "neutral" },
    { id: "analyze", title: "爆款结构分析", icon: "query_stats", tone: "neutral" },
    { id: "template", title: "生成可复用模板", icon: "auto_awesome", tone: "mint" },
  ],
  recentTitle: "最近拆解",
  recentToggleLabel: "切换空状态测试",
  recent,
  emptyTitle: "暂无拆解记录",
  emptyDescription: "粘贴上方视频链接，开启你的第一份爆款逻辑分析报告。",
};

const processing: ProcessingViewModel = {
  source: "design-fixture",
  title: "正在深度拆解视频逻辑...",
  input: "https://v.douyin.com/ie9wH...",
  currentTitle: "正在深度拆解视频逻辑...",
  currentDescription: "AI 正在按阶段读取链接、媒体与内容证据。",
  cancelLabel: "取消拆解",
  downloadProgress: 82,
  downloadSummary: "已下载 45.2MB / 55.1MB（2.4MB/s）",
  steps: [
    { stage: "detect-platform", label: "识别平台", status: "succeeded", statusLabel: "完成" },
    { stage: "resolve-link", label: "解析链接", status: "succeeded", statusLabel: "完成" },
    { stage: "parse-content", label: "提取内容", status: "succeeded", statusLabel: "完成", detail: "标题=\"如何在2024年打造个人IP\" · 作者=\"IP架构师老李\" · 时长=04:12" },
    { stage: "select-media", label: "选择资源", status: "succeeded", statusLabel: "完成", detail: "视频质量=1080p · 水印=无水印（已处理）" },
    { stage: "download-media", label: "下载媒体", status: "running", statusLabel: "下载 82%", progress: 82, detail: "已下载 45.2MB / 55.1MB（2.4MB/s）" },
    { stage: "obtain-transcript", label: "语音转文字（ASR）", status: "pending", statusLabel: "等待中" },
    { stage: "save-artifacts", label: "智能分镜分析", status: "pending", statusLabel: "等待中" },
  ],
  recent,
};

const analysisResult: AnalysisResultViewModel = {
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

const videoDetail: DetailViewModel = {
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
  tabs: ["原始文稿", "AI自动拆解"],
  activeTab: "AI自动拆解",
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

const galleryDetail: DetailViewModel = {
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

const create: CreateViewModel = {
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

const assets: AssetsViewModel = {
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

const settings: SettingsViewModel = {
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

const publish: PublishViewModel = {
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

const vitalityScan: VitalityScanViewModel = {
  source: "design-fixture",
  brand: "Vitality AI",
  title: "AI 智能诊疗",
  description: "请将面部或舌部对准扫描框以获取精准分析。",
  scanLabel: "立即拍摄",
  uploadLabel: "上传照片",
  adviceTitle: "拍摄建议",
  advice: [
    { icon: "sunny", text: "保持光线明亮自然，避免阴影。" },
    { icon: "face", text: "面部放松，舌体自然伸出不卷曲。" },
  ],
  historyTitle: "最近诊断记录",
  historyDescription: "查看过往分析报告",
};

const vitalityResult: VitalityResultViewModel = {
  source: "design-fixture",
  title: "诊断结果",
  scoreTitle: "整体健康评分",
  scoreDescription: "基于面部和舌象AI分析",
  score: 86,
  scoreMax: 100,
  faceMedia: media("面部分析示例图", "sage", images.face, "4 / 3"),
  tongueMedia: media("舌象分析示例图", "warm", images.tongue, "4 / 3"),
  faceTitle: "面部分析",
  tongueTitle: "舌象分析",
  completedLabel: "已完成",
  faceObservations: [
    { label: "气色 (Complexion)", value: "红润，略带疲惫" },
    { label: "眼部 (Eyes)", value: "轻微黑眼圈" },
  ],
  tongueObservations: [
    { label: "舌色 (Tongue Body Color)", value: "淡红" },
    { label: "苔色 (Coating Color)", value: "薄白" },
  ],
  recommendationTitle: "AI 调理建议",
  recommendations: [
    { icon: "check_circle", text: "综合诊断显示您目前处于亚健康状态，主要表现为轻度气虚。建议规律作息，避免熬夜。" },
    { icon: "restaurant", text: "饮食方面，可适量增加山药、红枣等健脾益气的食物，减少生冷油腻摄入。" },
    { icon: "self_improvement", text: "建议每日进行轻度有氧运动，如太极、瑜伽或快走，以促进气血运行。" },
  ],
  saveLabel: "保存报告",
  consultLabel: "咨询专家",
};

export function createStaticVisualDataAdapter(): VisualDataAdapter {
  return {
    source: "design-fixture",
    getHome: () => home,
    getProcessing: () => processing,
    getAnalysisResult: () => analysisResult,
    getDetail: (variant) => (variant === "gallery" ? galleryDetail : videoDetail),
    getCreate: () => create,
    getAssets: () => assets,
    getSettings: () => settings,
    getPublish: () => publish,
    getVitalityScan: () => vitalityScan,
    getVitalityResult: () => vitalityResult,
  };
}
