import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { motionDurations, motionEasing, primaryRouteOffset, routeOffset, type RouteTransitionDirection } from "../motion/tokens";
import type { NavigationTransition } from "../router";

export interface RouteTransitionProps {
  readonly pathname: string;
  readonly direction: RouteTransitionDirection;
  readonly transitionMode: NavigationTransition;
  readonly children: ReactNode;
}

function offsetFor(mode: NavigationTransition): number {
  if (mode === "primary") return primaryRouteOffset();
  if (mode === "push") return routeOffset;
  return 0;
}

function durationFor(mode: NavigationTransition): number {
  if (mode === "primary") return motionDurations.standard / 1000;
  return motionDurations.page / 1000;
}

export function RouteTransition({ pathname, direction, transitionMode, children }: RouteTransitionProps) {
  const isInstant = transitionMode === "instant";
  const previousTransitionMode = useRef<NavigationTransition | null>(null);
  const shouldAnimateEntry = previousTransitionMode.current === "instant";
  const offset = offsetFor(transitionMode);

  useEffect(() => {
    previousTransitionMode.current = transitionMode;
  }, [pathname, transitionMode]);

  const variants = {
    enter: (travel: RouteTransitionDirection) => ({
      opacity: 0,
      x: travel === "forward" ? offset : -offset,
    }),
    center: { opacity: 1, x: 0, transitionEnd: { transform: "none" } },
    exit: (travel: RouteTransitionDirection) => ({
      opacity: 0,
      x: travel === "forward" ? -offset : offset,
    }),
  };

  return (
    <MotionConfig reducedMotion="user">
      {isInstant ? (
        <div className="route-transition" data-transition-mode="instant" key={pathname}>{children}</div>
      ) : (
        <AnimatePresence custom={direction} initial={shouldAnimateEntry} mode="popLayout">
          <motion.div
            animate="center"
            className="route-transition"
            custom={direction}
            data-transition-mode={transitionMode}
            exit="exit"
            initial="enter"
            key={pathname}
            transition={{ duration: durationFor(transitionMode), ease: motionEasing.emphasized }}
            variants={variants}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      )}
    </MotionConfig>
  );
}
