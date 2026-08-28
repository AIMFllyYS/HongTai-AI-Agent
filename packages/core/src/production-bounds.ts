/**
 * The outer bounds every production document shares.
 *
 * These are limits, not a fit: staying inside them only means a document will not be rejected for a
 * count or a duration that no plan could hold. Making a blueprint into an actual plan is a separate
 * step, because a plan's shot durations must sum to exactly one chosen target duration, and the
 * create screen offers a few presets rather than the whole range.
 *
 * v4（文稿先行）并存于同一组边界：每镜时长来自对应句的实测 TTS 音频，不再要求镜头
 * 总和精确等于预设目标。实测路径的结构下限、软边界与「硬违规 / 软提示」的分类见下方
 * `MIN_MEASURED_SHOT_DURATION_MS` 与 `checkMeasuredProductionDurations`；v3 的全部常量与
 * 语义保持不变，存量调用方按原样继续使用。
 */

/** Shots one production may hold. */
export const MAX_SHOTS_PER_PRODUCTION = 12;

/** Seconds a single shot may run. */
export const MIN_SHOT_DURATION_SECONDS = 1;
export const MAX_SHOT_DURATION_SECONDS = 20;

/** Seconds a whole production may run. Which values inside it are offered is a UI decision. */
export const MIN_PRODUCTION_DURATION_SECONDS = 15;
export const MAX_PRODUCTION_DURATION_SECONDS = 60;

/**
 * v4 实测路径：单镜头时长的结构下限（毫秒）。低于此值的音频段不足以构成一个可渲染
 * 的镜头，属于硬违规；它比 v3 的整秒下限宽松得多，因为实测时长由真实语音决定。
 */
export const MIN_MEASURED_SHOT_DURATION_MS = 300;

/**
 * Separate visuals a montage needs before it can be cut at all.
 *
 * The planning service, the replica wizard's "ready to compose" test and the blueprint's usability
 * test all gate on this same floor, so it lives here rather than as a literal in each of them.
 */
export const MIN_MONTAGE_VISUAL_ASSETS = 3;

/**
 * v4 实测时长校验的稳定原因码。UI 与调用方只按 reason 分支：
 *
 * - hard（结构不可渲染，必须拒绝）：`shot-count-out-of-range`、`shot-duration-invalid`、
 *   `shot-too-short`。
 * - soft（可以回改文稿或确认后继续）：`shot-too-long`、`total-too-short`、`total-too-long`。
 */
export const MEASURED_DURATION_VIOLATION_REASONS = [
  "shot-count-out-of-range",
  "shot-duration-invalid",
  "shot-too-short",
  "shot-too-long",
  "total-too-short",
  "total-too-long",
] as const;
export type MeasuredDurationViolationReason = (typeof MEASURED_DURATION_VIOLATION_REASONS)[number];

/** One violation found by `checkMeasuredProductionDurations`. */
export interface MeasuredDurationViolation {
  readonly reason: MeasuredDurationViolationReason;
  readonly kind: "hard" | "soft";
  /** 1-based shot position; present only on per-shot violations. */
  readonly shotIndex?: number;
  /** Present only on per-shot violations. */
  readonly durationMs?: number;
  /** Present only on total-duration violations. */
  readonly totalDurationMs?: number;
}

/**
 * `ok` means "structurally acceptable": no hard violation, so the plan can proceed. Soft
 * violations are still listed (and `ok: true` may carry them) so the UI can offer to revise
 * the script or let the user confirm and continue — they never block silently.
 */
export type MeasuredProductionDurationCheck =
  | { readonly ok: true; readonly softViolations: readonly MeasuredDurationViolation[] }
  | {
      readonly ok: false;
      readonly hardViolations: readonly MeasuredDurationViolation[];
      readonly softViolations: readonly MeasuredDurationViolation[];
    };

/**
 * v4 时长校验：输入每镜的实测音频时长（毫秒，来自 `TtsTimedTrack.durationMs`），检查
 * 镜头数与单镜/总时长边界。单镜 20 秒与总时长 15–60 秒是软边界——超界提示回改文稿
 * 或确认继续，而不是拒绝；镜头数上限与结构下限仍是硬违规。校验结果结构化返回，
 * 供 UI 区分「必须修」与「建议修」。
 */
export function checkMeasuredProductionDurations(input: {
  readonly shotDurationMs: readonly number[];
}): MeasuredProductionDurationCheck {
  const hardViolations: MeasuredDurationViolation[] = [];
  const softViolations: MeasuredDurationViolation[] = [];

  if (input.shotDurationMs.length === 0 || input.shotDurationMs.length > MAX_SHOTS_PER_PRODUCTION) {
    hardViolations.push({ reason: "shot-count-out-of-range", kind: "hard" });
  }

  let totalMs = 0;
  for (const [index, durationMs] of input.shotDurationMs.entries()) {
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
      hardViolations.push({ reason: "shot-duration-invalid", kind: "hard", shotIndex: index + 1, durationMs });
      continue;
    }
    totalMs += durationMs;
    if (durationMs < MIN_MEASURED_SHOT_DURATION_MS) {
      hardViolations.push({ reason: "shot-too-short", kind: "hard", shotIndex: index + 1, durationMs });
    }
    if (durationMs > MAX_SHOT_DURATION_SECONDS * 1_000) {
      softViolations.push({ reason: "shot-too-long", kind: "soft", shotIndex: index + 1, durationMs });
    }
  }

  // 总时长只有在存在有效镜头时才有意义；0 个有效镜头时结构已 hard 违规，不叠加误导性的总量提示。
  if (totalMs > 0) {
    if (totalMs < MIN_PRODUCTION_DURATION_SECONDS * 1_000) {
      softViolations.push({ reason: "total-too-short", kind: "soft", totalDurationMs: totalMs });
    }
    if (totalMs > MAX_PRODUCTION_DURATION_SECONDS * 1_000) {
      softViolations.push({ reason: "total-too-long", kind: "soft", totalDurationMs: totalMs });
    }
  }

  if (hardViolations.length > 0) return { ok: false, hardViolations, softViolations };
  return { ok: true, softViolations };
}
