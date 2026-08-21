import { useEffect, useRef, useState } from "react";

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

export async function holdLazyModule<T>(loader: () => Promise<T>): Promise<T> {
  const [mod] = await Promise.all([
    loader(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, skeletonHoldMs());
    }),
  ]);
  return mod;
}

export function useSkeletonHold(pending: boolean): boolean {
  const [held, setHeld] = useState(pending);
  const shownAt = useRef<number | null>(pending ? Date.now() : null);

  useEffect(() => {
    if (pending) {
      shownAt.current = Date.now();
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
  }, [pending]);

  return held;
}
