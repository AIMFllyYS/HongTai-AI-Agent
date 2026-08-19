import { MIN_CUE_DURATION_MS, type ProductionPlanUpdate, type ProductionShotUpdate } from "@hongtai/core";

import type { PlanShotView, ProductionPlanView } from "./production-plan-view";

/** Shot bounds the plan schema owns; mirrored here so a control never offers an unusable value. */
export const MIN_SHOT_MS = 1_000;
export const MAX_SHOT_MS = 20_000;
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
  const target = clamp(Math.round(input.milliseconds), bounds.minMs, bounds.maxMs);
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
 * Cue count follows the copy and the subtitle template's line box, not the shot length, so a shot
 * too short for its narration produces captions that flash past unread. The service accepts them,
 * which makes saying so the tuning screen's job.
 */
export function shortCueCount(shot: PlanShotView): number {
  return shot.cues.filter((cue) => cue.endMs - cue.startMs < MIN_CUE_DURATION_MS).length;
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
 * restating unchanged values would turn every save into a whole-plan rewrite.
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
    ...(headline && headline !== plan.headlineText ? { headlineText: headline } : {}),
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
