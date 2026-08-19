import {
  buildShotCueTimeline,
  hasVisibleText,
  MAX_SHOT_DURATION_SECONDS,
  MIN_CUE_DURATION_MS,
  MIN_SHOT_DURATION_SECONDS,
  resolveTemplateForPrecision,
  type ProductionPlanUpdate,
  type ProductionShotUpdate,
  type SubtitleCueTiming,
} from "@hongtai/core";

import type { PlanShotView, ProductionPlanView } from "./production-plan-view";

/** The plan's own shot bounds, in the millisecond unit the controls work in. */
export const MIN_SHOT_MS = MIN_SHOT_DURATION_SECONDS * 1_000;
export const MAX_SHOT_MS = MAX_SHOT_DURATION_SECONDS * 1_000;
/** The step a duration control moves by. Finer steps read as jitter on a 390px screen. */
export const SHOT_STEP_MS = 100;

export interface ShotDraft {
  readonly order: number;
  readonly milliseconds: number;
  readonly narration: string;
  readonly caption: string;
  readonly assetId: string;
}

export interface PlanDraft {
  readonly shots: readonly ShotDraft[];
  readonly headlineText: string;
  readonly speechRate: number;
  readonly backgroundMusicAssetId: string | null;
  readonly backgroundMusicVolume: number;
  readonly subtitleTemplateId: string;
}

export function millisecondsOf(shot: PlanShotView): number {
  return Math.round(shot.durationSeconds * 1_000);
}

/** Seconds is the contract's unit; every value the draft sends is a whole millisecond in disguise. */
export function secondsFromMilliseconds(milliseconds: number): number {
  return Math.round(milliseconds) / 1_000;
}

export function planDraftFrom(plan: ProductionPlanView): PlanDraft {
  return {
    shots: plan.shots.map((shot) => ({
      order: shot.order,
      milliseconds: millisecondsOf(shot),
      narration: shot.narration,
      caption: shot.caption,
      assetId: shot.assetId,
    })),
    headlineText: plan.headlineText,
    speechRate: plan.speechRate,
    backgroundMusicAssetId: plan.backgroundMusicAssetId,
    backgroundMusicVolume: plan.backgroundMusicVolume,
    subtitleTemplateId: plan.subtitle?.requestedTemplateId ?? "",
  };
}

/**
 * The range this shot can take while the other shots can still absorb the difference and stay
 * inside their own bounds. Offering anything wider would let the user build a plan the service
 * has to reject for a total that no longer matches the target duration.
 */
export function shotDurationBounds(input: {
  readonly shots: readonly ShotDraft[];
  readonly order: number;
  readonly totalMilliseconds: number;
}): { readonly minMs: number; readonly maxMs: number } {
  const others = input.shots.filter((shot) => shot.order !== input.order).length;
  const minMs = Math.max(MIN_SHOT_MS, input.totalMilliseconds - others * MAX_SHOT_MS);
  const maxMs = Math.min(MAX_SHOT_MS, input.totalMilliseconds - others * MIN_SHOT_MS);
  return { minMs, maxMs: Math.max(minMs, maxMs) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Why every requested duration lands on the control's step: the shots that absorb the difference are
 * snapped to it too, so as long as the target total is also on the step the seconds the user reads
 * add up. A dragged slider would otherwise leave values like 9950 ms, shown as 9.9 s, and three of
 * those no longer sum to the stated total.
 */
function snapped(milliseconds: number): number {
  return Math.round(milliseconds / SHOT_STEP_MS) * SHOT_STEP_MS;
}

/**
 * Moves one shot to `milliseconds` and gives the difference back to the other shots in proportion
 * to their current length, so the total stays exactly the project's target duration. The renderer
 * requires that sum to match to the millisecond, so nothing here may round loosely.
 */
export function redistributeShotDuration(input: {
  readonly shots: readonly ShotDraft[];
  readonly order: number;
  readonly milliseconds: number;
  readonly totalMilliseconds: number;
}): readonly ShotDraft[] {
  const bounds = shotDurationBounds(input);
  const target = clamp(snapped(input.milliseconds), bounds.minMs, bounds.maxMs);
  const others = input.shots.filter((shot) => shot.order !== input.order);
  if (others.length === 0) return input.shots.map((shot) => ({ ...shot, milliseconds: input.totalMilliseconds }));

  const remaining = input.totalMilliseconds - target;
  const currentSum = others.reduce((sum, shot) => sum + shot.milliseconds, 0);
  const shares = new Map<number, number>();
  let assigned = 0;
  for (const [index, shot] of others.entries()) {
    // Shares snap to the control's step so the durations the user reads still add up to the total.
    // The last shot takes whatever is left, which is what keeps the sum exact to the millisecond.
    const share = index === others.length - 1
      ? remaining - assigned
      : Math.round((shot.milliseconds / currentSum) * remaining / SHOT_STEP_MS) * SHOT_STEP_MS;
    const bounded = clamp(share, MIN_SHOT_MS, MAX_SHOT_MS);
    shares.set(shot.order, bounded);
    assigned += bounded;
  }

  // Clamping and rounding can leave the total off by a few milliseconds. Push the difference onto
  // whichever shots still have headroom rather than silently accepting a mismatched total.
  let drift = remaining - [...shares.values()].reduce((sum, value) => sum + value, 0);
  while (drift !== 0) {
    const step = drift > 0 ? 1 : -1;
    const movable = others.find((shot) => {
      const value = shares.get(shot.order) ?? 0;
      return step > 0 ? value < MAX_SHOT_MS : value > MIN_SHOT_MS;
    });
    if (!movable) break;
    shares.set(movable.order, (shares.get(movable.order) ?? 0) + step);
    drift -= step;
  }

  return input.shots.map((shot) => shot.order === input.order
    ? { ...shot, milliseconds: target }
    : { ...shot, milliseconds: shares.get(shot.order) ?? shot.milliseconds });
}

export function draftTotalMilliseconds(shots: readonly ShotDraft[]): number {
  return shots.reduce((sum, shot) => sum + shot.milliseconds, 0);
}

/**
 * The tier an edit produces. `updatePlan` re-derives every cue from the copy and never accepts a
 * caller's timeline, so a manual edit can only ever claim an estimate.
 */
const EDIT_PRECISION = "estimated" as const;

export interface ShotPreview {
  /** The template that would actually burn in, after any degrade for missing word timing. */
  readonly templateId: string;
  readonly cues: readonly SubtitleCueTiming[];
  /** Cues too short to read. Planning allows them, so the screen has to say so. */
  readonly shortCues: number;
}

/**
 * What saving this draft would produce, not what the last save produced.
 *
 * This calls the same shared derivation `updatePlan` calls, so the preview is the outcome rather
 * than a second implementation that could drift. Showing the stored cues instead would keep a
 * 10-second timeline on screen after the shot was shortened to 1 second.
 */
export function previewShot(input: { readonly shot: ShotDraft; readonly requestedTemplateId: string }): ShotPreview {
  const resolved = resolveTemplateForPrecision({ requestedId: input.requestedTemplateId, precision: EDIT_PRECISION });
  const cues = buildShotCueTimeline({
    text: input.shot.narration,
    shotDurationMs: input.shot.milliseconds,
    typography: resolved.template.typography,
  });
  return {
    templateId: resolved.template.id,
    cues,
    shortCues: cues.filter((cue) => cue.endMs - cue.startMs < MIN_CUE_DURATION_MS).length,
  };
}

/**
 * Why these are refused before the request instead of after: the service rejects all of them, and a
 * save that can only fail is a worse answer than a field that says what it needs. The headline is the
 * one that would otherwise pass silently — `updatePlan` reads a blank value as "keep the current
 * one", so an empty submission looks accepted and comes back with the old headline still burned in.
 */
export function planDraftProblem(draft: PlanDraft): string | undefined {
  // Matches the service's own rule, so a zero-width paste is refused here instead of being accepted
  // by the page and then bounced back as a save failure the user cannot see the cause of.
  if (!hasVisibleText(draft.headlineText)) return "主文字不能为空。想换文字就直接改写，留空不会删掉它。";
  for (const shot of draft.shots) {
    if (!hasVisibleText(shot.caption)) return `第 ${shot.order} 个镜头的标题不能为空。`;
    if (!hasVisibleText(shot.narration)) return `第 ${shot.order} 个镜头的口播文案不能为空。`;
  }
  return undefined;
}

function shotUpdates(draft: PlanDraft, plan: ProductionPlanView): readonly ProductionShotUpdate[] {
  const before = new Map(plan.shots.map((shot) => [shot.order, shot]));
  return draft.shots.flatMap((shot) => {
    const original = before.get(shot.order);
    if (!original) return [];
    const duration = shot.milliseconds !== millisecondsOf(original);
    const narration = shot.narration.trim() !== original.narration;
    const caption = shot.caption.trim() !== original.caption;
    const asset = shot.assetId !== original.assetId;
    if (!duration && !narration && !caption && !asset) return [];
    return [{
      order: shot.order,
      ...(duration ? { durationSeconds: secondsFromMilliseconds(shot.milliseconds) } : {}),
      ...(narration ? { narration: shot.narration.trim() } : {}),
      ...(caption ? { caption: shot.caption.trim() } : {}),
      ...(asset ? { assetId: shot.assetId } : {}),
    }];
  });
}

/**
 * Only the fields the user actually moved. Omission means "leave as is" in the contract, so
 * restating unchanged values would turn every save into a whole-plan rewrite. Call
 * `planDraftProblem` first: this assumes the draft is submittable.
 */
export function buildPlanUpdate(input: {
  readonly draft: PlanDraft;
  readonly plan: ProductionPlanView;
  readonly expectedUpdatedAt: string;
}): ProductionPlanUpdate | undefined {
  const { draft, plan } = input;
  const shots = shotUpdates(draft, plan);
  const headline = draft.headlineText.trim();
  const update: ProductionPlanUpdate = {
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...(shots.length > 0 ? { shots } : {}),
    ...(headline !== plan.headlineText ? { headlineText: headline } : {}),
    ...(draft.speechRate !== plan.speechRate ? { speechRate: draft.speechRate } : {}),
    ...(draft.subtitleTemplateId && draft.subtitleTemplateId !== (plan.subtitle?.requestedTemplateId ?? "")
      ? { subtitleTemplateId: draft.subtitleTemplateId }
      : {}),
    // Clearing the music forces the volume to zero, so the two are never sent together.
    ...(draft.backgroundMusicAssetId !== plan.backgroundMusicAssetId
      ? { backgroundMusicAssetId: draft.backgroundMusicAssetId }
      : draft.backgroundMusicVolume !== plan.backgroundMusicVolume
        ? { backgroundMusicVolume: draft.backgroundMusicVolume }
        : {}),
  };
  return Object.keys(update).length > 1 ? update : undefined;
}
