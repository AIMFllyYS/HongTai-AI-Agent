export const motionDurations = {
  instant: 80,
  fast: 140,
  standard: 220,
  page: 260,
  /** Minimum time a route/list skeleton stays visible so it does not flash. */
  skeleton: 400,
} as const;

type CubicBezier = [number, number, number, number];

export const motionEasing = {
  standard: [0.2, 0, 0, 1] as CubicBezier,
  emphasized: [0.2, 0.8, 0.2, 1] as CubicBezier,
} as const;

/** Nested / `push` route travel, in pixels. */
export const routeOffset = 24;

const PRIMARY_ROUTE_OFFSET_RATIO = 0.28;
const PRIMARY_ROUTE_OFFSET_MAX = 140;

export function primaryRouteOffset(width = typeof window === "undefined" ? 390 : window.innerWidth): number {
  return Math.min(Math.round(width * PRIMARY_ROUTE_OFFSET_RATIO), PRIMARY_ROUTE_OFFSET_MAX);
}

export type RouteTransitionDirection = "forward" | "backward";
