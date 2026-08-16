import { isTerminalTaskStatus } from "@hongtai/core";
import type {
  AppTaskRecord,
  ContentAnalysisRecord,
  StageStatus,
  SupportedPlatform,
  TaskEventRecord,
  TaskStage,
  TaskStatus,
} from "@hongtai/core";

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

export interface ContentAnalysisView {
  readonly available: boolean;
  readonly overview?: {
    readonly summary: string;
    readonly theme: string;
    readonly targetAudiences: readonly string[];
    readonly communicationGoal?: string;
  };
  readonly hook?: {
    readonly type?: string;
    readonly description: string;
    readonly mechanism?: string;
    readonly evidenceRefs: readonly string[];
  };
  readonly painPoints: readonly AnalysisEvidenceItem[];
  readonly emotionalDrivers: readonly AnalysisEvidenceItem[];
  readonly structure: readonly AnalysisStructureItem[];
  readonly coreClaims: readonly AnalysisClaimItem[];
  readonly style?: {
    readonly tones: readonly string[];
    readonly pacing?: string;
    readonly languagePatterns: readonly string[];
    readonly interactionMechanisms: readonly string[];
  };
  readonly reusableTemplate?: {
    readonly formula: string;
    readonly steps: readonly string[];
    readonly variableSlots: readonly string[];
    readonly doNotCopy: readonly string[];
  };
  readonly risks: readonly AnalysisRiskItem[];
}

export interface AnalysisEvidenceItem {
  readonly description: string;
  readonly evidenceRefs: readonly string[];
}

export interface AnalysisStructureItem extends AnalysisEvidenceItem {
  readonly order: number;
  readonly summary: string;
  readonly role?: string;
  readonly techniques: readonly string[];
}

export interface AnalysisClaimItem {
  readonly claim: string;
  readonly supportLevel?: string;
  readonly evidenceRefs: readonly string[];
}

export interface AnalysisRiskItem extends AnalysisEvidenceItem {
  readonly category?: string;
  readonly level?: string;
  readonly suggestion?: string;
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const string = asString(item);
    return string ? [string] : [];
  }) : [];
}

function asEvidenceItem(value: unknown): AnalysisEvidenceItem | undefined {
  const record = asRecord(value);
  const description = asString(record?.description);
  return description ? { description, evidenceRefs: asStringArray(record?.evidenceRefs) } : undefined;
}

function asStructureItem(value: unknown): AnalysisStructureItem | undefined {
  const record = asRecord(value);
  const order = record?.order;
  const summary = asString(record?.summary);
  if (!record || typeof order !== "number" || !Number.isInteger(order) || order < 1 || !summary) return undefined;
  const role = asString(record.role);
  return {
    order,
    description: summary,
    summary,
    ...(role === undefined ? {} : { role }),
    techniques: asStringArray(record.techniques),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asClaimItem(value: unknown): AnalysisClaimItem | undefined {
  const record = asRecord(value);
  const claim = asString(record?.claim);
  if (!record || !claim) return undefined;
  const supportLevel = asString(record.supportLevel);
  return {
    claim,
    ...(supportLevel === undefined ? {} : { supportLevel }),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asRiskItem(value: unknown): AnalysisRiskItem | undefined {
  const record = asRecord(value);
  const description = asString(record?.description);
  if (!record || !description) return undefined;
  const category = asString(record.category);
  const level = asString(record.level);
  const suggestion = asString(record.suggestion);
  return {
    description,
    ...(category === undefined ? {} : { category }),
    ...(level === undefined ? {} : { level }),
    ...(suggestion === undefined ? {} : { suggestion }),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asArray<T>(value: unknown, map: (item: unknown) => T | undefined): readonly T[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const mapped = map(item);
    return mapped === undefined ? [] : [mapped];
  }) : [];
}

/**
 * Reads a safe, display-only projection of the already validated analysis
 * document. Missing or malformed fields stay empty; they are never repaired in
 * the application interface layer.
 */
export function readContentAnalysis(record: ContentAnalysisRecord): ContentAnalysisView {
  if (record.status !== "succeeded" || record.result?.schemaVersion !== "content-analysis.v1") {
    return { available: false, painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [], risks: [] };
  }

  const document = asRecord(record.result.document);
  if (!document) return { available: false, painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [], risks: [] };

  const overviewRecord = asRecord(document.overview);
  const summary = asString(overviewRecord?.summary);
  const theme = asString(overviewRecord?.theme);
  const hookRecord = asRecord(document.hook);
  const hookDescription = asString(hookRecord?.description);
  const styleRecord = asRecord(document.style);
  const templateRecord = asRecord(document.reusableTemplate);

  return {
    available: true,
    overview: summary && theme ? {
      summary,
      theme,
      targetAudiences: asStringArray(overviewRecord?.targetAudiences),
      ...(asString(overviewRecord?.communicationGoal) === undefined
        ? {}
        : { communicationGoal: asString(overviewRecord?.communicationGoal) }),
    } : undefined,
    hook: hookDescription ? {
      description: hookDescription,
      evidenceRefs: asStringArray(hookRecord?.evidenceRefs),
      ...(asString(hookRecord?.type) === undefined ? {} : { type: asString(hookRecord?.type) }),
      ...(asString(hookRecord?.mechanism) === undefined ? {} : { mechanism: asString(hookRecord?.mechanism) }),
    } : undefined,
    painPoints: asArray(document.painPoints, asEvidenceItem),
    emotionalDrivers: asArray(document.emotionalDrivers, asEvidenceItem),
    structure: asArray(document.structure, asStructureItem),
    coreClaims: asArray(document.coreClaims, asClaimItem),
    style: styleRecord ? {
      tones: asStringArray(styleRecord.tones),
      pacing: asString(styleRecord.pacing),
      languagePatterns: asStringArray(styleRecord.languagePatterns),
      interactionMechanisms: asStringArray(styleRecord.interactionMechanisms),
    } : undefined,
    reusableTemplate: templateRecord && asString(templateRecord.formula) ? {
      formula: asString(templateRecord.formula)!,
      steps: asStringArray(templateRecord.steps),
      variableSlots: asStringArray(templateRecord.variableSlots),
      doNotCopy: asStringArray(templateRecord.doNotCopy),
    } : undefined,
    risks: asArray(document.risks, asRiskItem),
  };
}
