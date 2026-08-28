/**
 * v4（文稿先行）管线的运行期 DTO 与纯映射助手。
 *
 * AppRuntime 的版本化 DTO 模式在此沿用：界面只收到带 `schemaVersion` 的稳定投影，
 * 永不接触 `PersistedProject` 或原始 native 响应。分镜与配音的权威持久化仍走
 * `project.json`（`standalone-production-record.ts`）；本文件只做只读投影与事件映射，
 * 不持有状态。
 */
import type {
  JsonObject,
  MeasuredDurationViolation,
  ProductionEvent,
  ProductionProjectRecord,
  ScriptStoryboard,
  TaskIssue,
  TtsTimingAlignmentSource,
} from "@hongtai/core";
import { scriptStoryboardEstimatedTotalMs } from "@hongtai/core";

import type { NativeProductionProgressEvent } from "./standalone-bridge.js";
import { pairedNarration, type PersistedProject } from "./standalone-production-record.js";

export const PRODUCTION_SCRIPT_RECORD_VERSION = "production-script.v1";

/** 分镜脚本的界面投影：`document` 即 `script-storyboard.v1` 契约文档。 */
export interface ProductionScriptRecord {
  readonly schemaVersion: typeof PRODUCTION_SCRIPT_RECORD_VERSION;
  readonly projectId: string;
  readonly storyboard: { readonly schemaVersion: ScriptStoryboard["schemaVersion"]; readonly document: JsonObject };
  /** 按字符估算的预估总时长（毫秒）。仅用于生成阶段展示，实测以配音记录为准。 */
  readonly estimatedTotalMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PRODUCTION_NARRATION_RECORD_VERSION = "production-narration.v1";

/** 单句配音状态：`ready` 表示音轨与音频文件都已就绪，`missing` 表示需要（重新）合成。 */
export interface ProductionNarrationSentenceState {
  readonly sentenceId: string;
  readonly status: "ready" | "missing";
  readonly durationMs?: number;
  readonly alignmentSource?: TtsTimingAlignmentSource;
}

/** 本次合成调用中失败句子的稳定问题码；界面按 `issue.code` 分支，定位重试入口。 */
export interface ProductionNarrationFailure {
  readonly sentenceId: string;
  readonly issue: TaskIssue;
}

/** 逐句配音的界面投影：就绪句子、缺失句子与本次调用的失败明细。 */
export interface ProductionNarrationRecord {
  readonly schemaVersion: typeof PRODUCTION_NARRATION_RECORD_VERSION;
  readonly projectId: string;
  readonly mode: "system" | "provider";
  readonly sentences: readonly ProductionNarrationSentenceState[];
  /** 已就绪句子的实测时长合计（毫秒）。界面据此展示「实测总时长」。 */
  readonly totalDurationMs: number;
  readonly failures: readonly ProductionNarrationFailure[];
  readonly updatedAt: string;
}

export const PRODUCTION_MEASURED_PLAN_RESULT_VERSION = "production-measured-plan.v1";

/** 组装 v4 计划的结果投影：软违规结构化返回（提示回改文稿或确认后继续），从不阻塞。 */
export interface MeasuredPlanComposeResult {
  readonly schemaVersion: typeof PRODUCTION_MEASURED_PLAN_RESULT_VERSION;
  readonly project: ProductionProjectRecord;
  readonly softViolations: readonly MeasuredDurationViolation[];
}

/**
 * 制作事件的 v4 扩展：逐句配音阶段没有整体百分比可报（见 bridge 的进度事件契约），
 * 因此不塞进 `render-progress` 编造 progress，而是携带句子定位的独立事件类型。
 */
export type StandaloneProductionEvent =
  | ProductionEvent
  | {
    readonly type: "narration-progress";
    readonly projectId: string;
    readonly stage: string;
    readonly sentenceIndex?: number;
    readonly total?: number;
    readonly sentenceId?: string;
  }
  | {
    /**
     * 分镜脚本生成的流式增量（含 provider 推理文本）。运行期内存事件：界面只做
     * 有界展示，绝不写入 project.json 或任何持久化文件。
     */
    readonly type: "script-progress";
    readonly projectId: string;
    /** 初稿 generating；格式修复轮 repairing。 */
    readonly phase: "generating" | "repairing";
    readonly contentDelta?: string;
    readonly reasoningDelta?: string;
    /** 本次生成累计接收的正文（content delta）字符数，单调递增。 */
    readonly receivedCharacters: number;
  };

/** 把 native 的 `synthesize_narration` 进度事件映射为界面事件；其他阶段交由渲染监听处理。 */
export function narrationProgressEvent(event: NativeProductionProgressEvent): StandaloneProductionEvent | undefined {
  if (event.stage !== "synthesize_narration") return undefined;
  return {
    type: "narration-progress",
    projectId: event.projectId,
    stage: event.stage,
    ...(typeof event.sentenceIndex === "number" ? { sentenceIndex: event.sentenceIndex } : {}),
    ...(typeof event.total === "number" ? { total: event.total } : {}),
    ...(typeof event.sentenceId === "string" && event.sentenceId ? { sentenceId: event.sentenceId } : {}),
  };
}

export function toScriptRecord(project: PersistedProject): ProductionScriptRecord | undefined {
  const storyboard = project.storyboard;
  if (!storyboard) return undefined;
  return {
    schemaVersion: PRODUCTION_SCRIPT_RECORD_VERSION,
    projectId: project.projectId,
    storyboard: { schemaVersion: storyboard.schemaVersion, document: storyboard as unknown as JsonObject },
    estimatedTotalMs: scriptStoryboardEstimatedTotalMs(storyboard),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function toNarrationRecord(
  project: PersistedProject,
  mode: "system" | "provider",
  failures: readonly ProductionNarrationFailure[],
): ProductionNarrationRecord | undefined {
  const storyboard = project.storyboard;
  if (!storyboard) return undefined;
  const paired = pairedNarration(project);
  const sentences = storyboard.sentences.map((sentence): ProductionNarrationSentenceState => {
    const entry = paired.get(sentence.id);
    if (!entry) return { sentenceId: sentence.id, status: "missing" };
    return {
      sentenceId: sentence.id,
      status: "ready",
      durationMs: entry.track.durationMs,
      alignmentSource: entry.track.alignmentSource,
    };
  });
  return {
    schemaVersion: PRODUCTION_NARRATION_RECORD_VERSION,
    projectId: project.projectId,
    mode,
    sentences,
    totalDurationMs: sentences.reduce((sum, sentence) => sum + (sentence.durationMs ?? 0), 0),
    failures,
    updatedAt: project.updatedAt,
  };
}
