export const motionDurations = {
  instant: 80,
  fast: 140,
  standard: 220,
  page: 260,
} as const;

type CubicBezier = [number, number, number, number];

export const motionEasing = {
  standard: [0.2, 0, 0, 1] as CubicBezier,
  emphasized: [0.2, 0.8, 0.2, 1] as CubicBezier,
} as const;

export const routeOffset = 16;

export type RouteTransitionDirection = "forward" | "backward";
