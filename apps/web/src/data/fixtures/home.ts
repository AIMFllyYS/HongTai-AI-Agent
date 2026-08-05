import type { HomeViewModel, ProcessingViewModel } from "../visual-types";
import { recent } from "./media";

export const home: HomeViewModel = {
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

export const processing: ProcessingViewModel = {
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
