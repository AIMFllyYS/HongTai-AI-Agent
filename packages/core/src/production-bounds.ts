/**
 * The outer bounds every production document shares.
 *
 * These are limits, not a fit: staying inside them only means a document will not be rejected for a
 * count or a duration that no plan could hold. Making a blueprint into an actual plan is a separate
 * step, because a plan's shot durations must sum to exactly one chosen target duration, and the
 * create screen offers a few presets rather than the whole range.
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
 * Separate visuals a montage needs before it can be cut at all.
 *
 * The planning service, the replica wizard's "ready to compose" test and the blueprint's usability
 * test all gate on this same floor, so it lives here rather than as a literal in each of them.
 */
export const MIN_MONTAGE_VISUAL_ASSETS = 3;
