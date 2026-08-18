import { useEffect, useState } from "react";

/** Cold-start brand dwell. Not a progress interval. */
export const BRAND_SPLASH_DURATION_MS = 2500;

let splashStartedAtMs = 0;

export function startBrandSplashClock(now = Date.now()): number {
  if (splashStartedAtMs === 0) {
    splashStartedAtMs = now;
  }
  return splashStartedAtMs;
}

export function brandSplashRemainingMs(now = Date.now(), durationMs = BRAND_SPLASH_DURATION_MS): number {
  return Math.max(0, durationMs - (now - startBrandSplashClock(now)));
}

export function resetBrandSplashClockForTests(): void {
  splashStartedAtMs = 0;
}

export function useBrandSplashReady(): boolean {
  const [ready, setReady] = useState(() => brandSplashRemainingMs() === 0);

  useEffect(() => {
    const remaining = brandSplashRemainingMs();
    if (remaining === 0) {
      setReady(true);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), remaining);
    return () => window.clearTimeout(timer);
  }, []);

  return ready;
}
