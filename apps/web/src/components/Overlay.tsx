import {
  createContext,
  useContext,
  useEffect,
  type PointerEvent as ReactPointerEvent,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, MotionConfig, motion, useDragControls, useReducedMotion } from "motion/react";

import { motionDurations, motionEasing } from "../motion/tokens";
import { shouldDismissSheet } from "../motion/sheet-dismiss";

const OverlayDragContext = createContext<((event: ReactPointerEvent<HTMLElement>) => void) | undefined>(undefined);

export function OverlayDragRegion({ className, label, children }: PropsWithChildren<{ readonly className?: string; readonly label?: string }>) {
  const startDrag = useContext(OverlayDragContext);
  return (
    <div
      aria-label={label}
      className={className}
      onPointerDown={(event) => {
        if (event.button !== 0 || !startDrag) return;
        startDrag(event);
      }}
    >
      {children}
    </div>
  );
}

export interface OverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly placement: "rise" | "center";
  readonly labelledBy?: string;
  readonly label?: string;
  readonly panelClassName?: string;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}

export function Overlay({
  open,
  onClose,
  placement,
  labelledBy,
  label,
  panelClassName = "",
  initialFocusRef,
  returnFocusRef,
  children,
}: OverlayProps) {
  const reducedMotion = useReducedMotion();
  const dragControls = useDragControls();
  const canDrag = placement === "rise" && !reducedMotion;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      initialFocusRef?.current?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      returnFocusRef?.current?.focus();
    };
  }, [initialFocusRef, onClose, open, returnFocusRef]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canDrag) return;
    dragControls.start(event);
  };

  if (typeof document === "undefined") return null;

  const duration = (placement === "rise" ? motionDurations.standard : motionDurations.fast) / 1000;
  const panelMotion = placement === "rise"
    ? reducedMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
    : reducedMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 } };

  return createPortal(
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="overlay-scrim"
            data-no-swipe=""
            data-placement={placement}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="overlay"
            onClick={onClose}
            role="presentation"
            transition={{ duration: motionDurations.fast / 1000, ease: motionEasing.standard }}
          >
            <OverlayDragContext.Provider value={canDrag ? startDrag : undefined}>
              <motion.div
                animate={panelMotion.animate}
                aria-labelledby={labelledBy}
                aria-label={labelledBy ? undefined : label}
                aria-modal="true"
                className={`overlay-panel overlay-panel--${placement} ${panelClassName}`.trim()}
                data-no-swipe=""
                drag={canDrag ? "y" : false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragControls={dragControls}
                dragElastic={{ top: 0.04, bottom: 0.55 }}
                dragListener={false}
                exit={panelMotion.exit}
                initial={panelMotion.initial}
                onClick={(event) => event.stopPropagation()}
                onDragEnd={(_event, info) => {
                  if (shouldDismissSheet(info.offset.y, info.velocity.y)) onClose();
                }}
                role="dialog"
                transition={{ duration, ease: motionEasing.emphasized }}
              >
                {children}
              </motion.div>
            </OverlayDragContext.Provider>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>,
    document.body,
  );
}
