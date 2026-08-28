/**
 * Deterministic source-window planning for avatar (数字人) productions.
 *
 * The user uploads ONE pre-processed avatar video; narration audio and subtitles are ours. This
 * module is the single place that decides how that finite source is cut and stitched to cover
 * every shot's measured TTS duration: a cursor consumes the source from 0 ms onward, wraps back
 * to 0 ms when it reaches the tail, and a shot that spans the tail simply gets two windows
 * ("裁剪不同片段、不够就拼凑延长" — copy, cut and extend, never fail on a duration mismatch).
 *
 * Pure function, no I/O, no Android/Capacitor concerns: Kotlin renders the windows it is given
 * and never re-decides the mapping (hard layer rule).
 */

/**
 * Floor below which an avatar source video is rejected outright. A shorter clip would have to
 * loop many times per shot, which reads as a strobe glitch rather than a presenter.
 */
export const MIN_AVATAR_SOURCE_DURATION_MS = 2_000;

/** Sources shorter than this still work but loop often enough to look repetitive; soft hint only. */
export const RECOMMENDED_AVATAR_SOURCE_DURATION_MS = 5_000;

/**
 * Stable reason codes for `planAvatarSourceWindows`. UI branches on `reason` only:
 *
 * - hard（无法规划窗口）: `avatar-source-duration-invalid`、`avatar-source-too-short`、
 *   `avatar-shot-duration-invalid`。
 * - soft（可继续，仅提示）: `avatar-source-short`。
 */
export const AVATAR_SEGMENT_PLAN_VIOLATION_REASONS = [
  "avatar-source-duration-invalid",
  "avatar-source-too-short",
  "avatar-source-short",
  "avatar-shot-duration-invalid",
] as const;
export type AvatarSegmentPlanViolationReason = (typeof AVATAR_SEGMENT_PLAN_VIOLATION_REASONS)[number];

/** One contiguous slice of the source video, in source-local milliseconds. */
export interface AvatarSourceWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** The windows one shot consumes, in playback order; their durations sum to `durationMs`. */
export interface AvatarSegmentShot {
  /** 1-based shot position, matching the plan's shot order. */
  readonly shotIndex: number;
  readonly durationMs: number;
  readonly windows: readonly AvatarSourceWindow[];
}

/**
 * The only soft advisory the planner can emit: the source is usable but shorter than recommended,
 * so it loops often enough to look repetitive. Structurally a `MeasuredDurationViolation` (same
 * reason channel as the duration checks), so the compose result can carry it unchanged.
 */
export interface AvatarSourceShortAdvisory {
  readonly reason: "avatar-source-short";
  readonly kind: "soft";
  readonly sourceDurationMs: number;
}

/** A hard reason the planner could not map windows at all; callers must not render from a failed plan. */
export interface AvatarSegmentHardViolation {
  readonly reason: Exclude<AvatarSegmentPlanViolationReason, "avatar-source-short">;
  readonly kind: "hard";
  /** Present only on source-duration violations. */
  readonly sourceDurationMs?: number;
  /** Present only on per-shot violations. */
  readonly shotIndex?: number;
  readonly durationMs?: number;
}

/**
 * `ok: true` carries one window list per input shot (in order). `ok: false` means no windows were
 * planned at all — callers must not render from a failed plan.
 */
export type AvatarSegmentPlanResult =
  | {
    readonly ok: true;
    readonly shots: readonly AvatarSegmentShot[];
    readonly softViolations: readonly AvatarSourceShortAdvisory[];
  }
  | {
    readonly ok: false;
    readonly shots: readonly [];
    readonly hardViolations: readonly AvatarSegmentHardViolation[];
    readonly softViolations: readonly AvatarSourceShortAdvisory[];
  };

/**
 * Map each shot's measured duration onto windows of a single avatar source video.
 *
 * Shot-count and shot/total duration bounds are NOT re-checked here — `checkMeasuredProductionDurations`
 * owns that domain and runs before composing; only what the window math itself needs (a usable
 * source duration and positive finite shot durations) is validated locally.
 *
 * The cursor is shared across shots so consecutive shots continue where the previous one stopped:
 * a 6 s + 5 s narration over a 10 s source plays [0,6] then [6,10]+[0,1], not two restarts at 0.
 */
export function planAvatarSourceWindows(input: {
  readonly sourceDurationMs: number;
  readonly shotDurationMs: readonly number[];
}): AvatarSegmentPlanResult {
  const hardViolations: AvatarSegmentHardViolation[] = [];
  const softViolations: AvatarSourceShortAdvisory[] = [];

  if (
    typeof input.sourceDurationMs !== "number" ||
    !Number.isFinite(input.sourceDurationMs) ||
    input.sourceDurationMs <= 0
  ) {
    hardViolations.push({ reason: "avatar-source-duration-invalid", kind: "hard", sourceDurationMs: input.sourceDurationMs });
  } else if (input.sourceDurationMs < MIN_AVATAR_SOURCE_DURATION_MS) {
    hardViolations.push({ reason: "avatar-source-too-short", kind: "hard", sourceDurationMs: input.sourceDurationMs });
  } else if (input.sourceDurationMs < RECOMMENDED_AVATAR_SOURCE_DURATION_MS) {
    softViolations.push({ reason: "avatar-source-short", kind: "soft", sourceDurationMs: input.sourceDurationMs });
  }

  for (const [index, durationMs] of input.shotDurationMs.entries()) {
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
      hardViolations.push({ reason: "avatar-shot-duration-invalid", kind: "hard", shotIndex: index + 1, durationMs });
    }
  }

  if (hardViolations.length > 0) {
    return { ok: false, shots: [], hardViolations, softViolations };
  }

  const sourceMs = input.sourceDurationMs;
  const shots: AvatarSegmentShot[] = [];
  let cursorMs = 0;
  for (const [index, durationMs] of input.shotDurationMs.entries()) {
    const windows: AvatarSourceWindow[] = [];
    let remainingMs = durationMs;
    while (remainingMs > 0) {
      const takeMs = Math.min(remainingMs, sourceMs - cursorMs);
      windows.push({ startMs: cursorMs, endMs: cursorMs + takeMs });
      cursorMs += takeMs;
      remainingMs -= takeMs;
      if (cursorMs >= sourceMs) cursorMs = 0;
    }
    shots.push({ shotIndex: index + 1, durationMs, windows });
  }
  return { ok: true, shots, softViolations };
}
