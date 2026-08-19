/**
 * Bounds every production document shares.
 *
 * A replica blueprint is a shopping list for a video that will later become a plan, so its shot
 * count and durations have to fit inside what a plan can express. Keeping the numbers here means a
 * blueprint cannot describe a video the renderer would refuse to build.
 */

/** Shots one production may hold. */
export const MAX_SHOTS_PER_PRODUCTION = 12;

/** Seconds a single shot may run. */
export const MIN_SHOT_DURATION_SECONDS = 1;
export const MAX_SHOT_DURATION_SECONDS = 20;

/** Seconds a whole production may run, which is also the range the project creator accepts. */
export const MIN_PRODUCTION_DURATION_SECONDS = 15;
export const MAX_PRODUCTION_DURATION_SECONDS = 60;
