import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { motionDurations, motionEasing, routeOffset, type RouteTransitionDirection } from "../motion/tokens";
import type { NavigationTransition } from "../router";

export interface RouteTransitionProps {
  readonly pathname: string;
  readonly direction: RouteTransitionDirection;
  readonly transitionMode: NavigationTransition;
  readonly children: ReactNode;
}

const variants = {
  enter: (direction: RouteTransitionDirection) => ({
    opacity: 0,
    x: direction === "forward" ? routeOffset : -routeOffset,
  }),
  center: { opacity: 1, x: 0 },
  exit: (direction: RouteTransitionDirection) => ({
    opacity: 0,
    x: direction === "forward" ? -routeOffset : routeOffset,
  }),
};

export function RouteTransition({ pathname, direction, transitionMode, children }: RouteTransitionProps) {
  const isInstant = transitionMode === "instant";
  const previousTransitionMode = useRef<NavigationTransition | null>(null);
  const shouldAnimateEntry = previousTransitionMode.current === "instant";

  useEffect(() => {
    previousTransitionMode.current = transitionMode;
  }, [pathname, transitionMode]);

  return (
    <MotionConfig reducedMotion="user">
      {isInstant ? (
        <div className="route-transition" data-transition-mode="instant" key={pathname}>{children}</div>
      ) : (
        <AnimatePresence custom={direction} initial={shouldAnimateEntry} mode="wait">
          <motion.div
            animate="center"
            className="route-transition"
            custom={direction}
            data-transition-mode="animated"
            exit="exit"
            initial="enter"
            key={pathname}
            transition={{ duration: motionDurations.page / 1000, ease: motionEasing.emphasized }}
            variants={variants}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      )}
    </MotionConfig>
  );
}
