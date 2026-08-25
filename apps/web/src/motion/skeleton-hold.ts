import { createContext, createElement, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";

import { motionDurations } from "./tokens";

export function skeletonHoldMs(): number {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return motionDurations.instant;
  }
  return motionDurations.skeleton;
}

export function remainingSkeletonHold(startedAt: number | null, now: number, minMs: number): number {
  if (startedAt == null) return 0;
  return Math.max(0, minMs - (now - startedAt));
}

const RouteSkeletonStartedAtContext = createContext<number | undefined>(undefined);

/**
 * Starts one skeleton clock for a route transition.  Lazy module loading and
 * the first page-data read share this clock, so a slow module cannot add a
 * second artificial skeleton dwell after the route fallback disappears.
 */
export function RouteSkeletonTimingProvider({ children }: PropsWithChildren) {
  const [startedAt] = useState(() => Date.now());
  return createElement(RouteSkeletonStartedAtContext.Provider, { value: startedAt }, children);
}

export function useSkeletonHold(pending: boolean): boolean {
  const routeStartedAt = useContext(RouteSkeletonStartedAtContext);
  const [held, setHeld] = useState(pending);
  const shownAt = useRef<number | null>(pending ? routeStartedAt ?? Date.now() : null);

  useEffect(() => {
    if (pending) {
      if (shownAt.current == null) shownAt.current = routeStartedAt ?? Date.now();
      setHeld(true);
      return undefined;
    }
    const remain = remainingSkeletonHold(shownAt.current, Date.now(), skeletonHoldMs());
    if (remain <= 0) {
      shownAt.current = null;
      setHeld(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      shownAt.current = null;
      setHeld(false);
    }, remain);
    return () => window.clearTimeout(timer);
  }, [pending, routeStartedAt]);

  return held;
}
