import { isTerminalTaskStatus } from "@hongtai/core";
import type {
  AppTaskRecord,
  StageStatus,
  SupportedPlatform,
  TaskEventRecord,
  TaskStage,
  TaskStatus,
} from "@hongtai/core";

import { readContentAnalysis } from "./content-analysis-presenters";

export { readContentAnalysis };
export type {
  AnalysisClaimItem,
  AnalysisEvidenceItem,
  AnalysisRiskItem,
  AnalysisStructureItem,
  ContentAnalysisView,
} from "./content-analysis-presenters";

export const TASK_STAGE_ORDER: readonly TaskStage[] = [
  "detect-platform",
  "resolve-link",
  "parse-content",
  "select-media",
  "download-media",
  "obtain-transcript",
  "save-artifacts",
];

const stageLabels: Readonly<Record<TaskStage, string>> = {
  "detect-platform": "识别平台",
  "resolve-link": "解析链接",
  "parse-content": "提取内容",
  "select-media": "选择媒体",
  "download-media": "下载媒体",
  "obtain-transcript": "获取文稿",
  "save-artifacts": "保存产物",
};

const stageStatusLabels: Readonly<Record<StageStatus, string>> = {
  pending: "等待中",
  running: "进行中",
  succeeded: "已完成",
  degraded: "已保留部分结果",
  failed: "失败",
};

const taskStatusLabels: Readonly<Record<TaskStatus, string>> = {
  queued: "等待执行",
  running: "处理中",
  succeeded: "已完成",
  degraded: "部分完成",
  failed: "处理失败",
  cancelled: "已停止",
  interrupted: "已中断",
};

export type RuntimeStatusTone = "completed" | "processing" | "pending" | "failed" | "neutral";

export interface TaskStagePresentation {
  readonly stage: TaskStage;
  readonly label: string;
  readonly status: StageStatus;
  readonly statusLabel: string;
  readonly detail?: string;
  readonly progress?: number;
  readonly sequence?: number;
  readonly timestamp?: string;
}

function isProgressEvent(event: TaskEventRecord): event is Extract<TaskEventRecord, { readonly stage: TaskStage }> {
  return "stage" in event;
}

function safeProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const percentage = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Projects persisted task events into the immutable seven-stage UI. No stage is
 * inferred as completed merely because a later stage exists.
 */
export function buildTaskStagePresentations(
  task: AppTaskRecord,
  events: readonly TaskEventRecord[],
): readonly TaskStagePresentation[] {
  const latestByStage = new Map<TaskStage, Extract<TaskEventRecord, { readonly stage: TaskStage }>>();
  const orderedEvents = events
    .filter((event) => event.taskId === task.id)
    .slice()
    .sort((left, right) => left.sequence - right.sequence);

  for (const event of orderedEvents) {
    if (isProgressEvent(event)) latestByStage.set(event.stage, event);
  }

  return TASK_STAGE_ORDER.map((stage) => {
    const event = latestByStage.get(stage);
    if (event) {
      return {
        stage,
        label: stageLabels[stage],
        status: event.status,
        statusLabel: stageStatusLabels[event.status],
        detail: event.message || undefined,
        ...(safeProgress(event.progress) === undefined ? {} : { progress: safeProgress(event.progress) }),
        sequence: event.sequence,
        timestamp: event.timestamp,
      };
    }

    const isCurrentStage = task.status === "running" && task.currentStage === stage;
    if (isCurrentStage) {
      return {
        stage,
        label: stageLabels[stage],
        status: "running",
        statusLabel: stageStatusLabels.running,
      };
    }
    if (isTerminalTaskStatus(task.status)) {
      return {
        stage,
        label: stageLabels[stage],
        status: "degraded",
        statusLabel: "已跳过",
      };
    }
    return {
      stage,
      label: stageLabels[stage],
      status: "pending",
      statusLabel: stageStatusLabels.pending,
    };
  });
}

export function taskStatusLabel(status: TaskStatus): string {
  return taskStatusLabels[status];
}

export function taskStatusTone(status: TaskStatus): RuntimeStatusTone {
  if (status === "succeeded") return "completed";
  if (status === "running") return "processing";
  if (status === "queued") return "pending";
  if (status === "failed" || status === "interrupted") return "failed";
  return "neutral";
}

export function platformLabel(platform: SupportedPlatform | undefined): string | undefined {
  if (platform === "douyin") return "抖音";
  if (platform === "xiaohongshu") return "小红书";
  if (platform === "bilibili") return "B站";
  if (platform === "kuaishou") return "快手（实验性）";
  return undefined;
}

export function contentTypeLabel(contentType: AppTaskRecord["contentType"]): string | undefined {
  if (contentType === "video") return "视频";
  if (contentType === "image_text") return "图文";
  return undefined;
}

export function mediaOrientationLabel(media?: { readonly width?: number; readonly height?: number }): string | undefined {
  if (typeof media?.width !== "number" || typeof media?.height !== "number" || media.width <= 0 || media.height <= 0) {
    return undefined;
  }
  if (media.height > media.width) return "竖屏";
  if (media.width > media.height) return "横屏";
  return undefined;
}

const structureRoleLabels: Readonly<Record<string, string>> = {
  opening: "开场",
  development: "展开",
  proof: "论证",
  transition: "过渡",
  closing: "收束",
  other: "其他",
};

export function structureRoleLabel(role?: string): string | undefined {
  if (!role) return undefined;
  return structureRoleLabels[role] ?? role;
}

const riskLevelLabels: Readonly<Record<string, string>> = {
  low: "低",
  medium: "中",
  high: "高",
};

export function riskLevelLabel(level?: string): string | undefined {
  if (!level) return undefined;
  return riskLevelLabels[level] ?? level;
}

export function formatTaskTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
