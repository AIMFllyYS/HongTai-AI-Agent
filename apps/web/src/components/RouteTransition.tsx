import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";
import { motionDurations, motionEasing, routeOffset, type RouteTransitionDirection } from "../motion/tokens";

export interface RouteTransitionProps {
  readonly pathname: string;
  readonly direction: RouteTransitionDirection;
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

export function RouteTransition({ pathname, direction, children }: RouteTransitionProps) {
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence custom={direction} initial={false} mode="wait">
        <motion.div
          animate="center"
          className="route-transition"
          custom={direction}
          exit="exit"
          initial="enter"
          key={pathname}
          transition={{ duration: motionDurations.page / 1000, ease: motionEasing.emphasized }}
          variants={variants}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
