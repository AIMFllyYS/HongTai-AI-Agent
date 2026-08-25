import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export const LONG_PRESS_DELAY_MS = 520;

export interface LongPressOptions {
  readonly onLongPress: () => void;
  readonly onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly delayMs?: number;
}

export interface LongPressHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * One pointer-timing contract for recent-record cards. The click gate stays
 * armed for the synthetic click that browsers send after a long press, so a
 * long press cannot also open the record detail page.
 */
export function useLongPress({ onLongPress, onClick, delayMs = LONG_PRESS_DELAY_MS }: LongPressOptions): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const pointerId = useRef<number | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const releasePointer = useCallback((target: HTMLElement) => {
    const activePointerId = pointerId.current;
    pointerId.current = undefined;
    if (activePointerId === undefined || !target.hasPointerCapture(activePointerId)) return;
    target.releasePointerCapture(activePointerId);
  }, []);

  const suppressClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!longPressed.current) return false;
    longPressed.current = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearTimer();
    longPressed.current = false;
    pointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      longPressed.current = true;
      onLongPress();
    }, Math.max(300, delayMs));
  }, [clearTimer, delayMs, onLongPress]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    clearTimer();
    releasePointer(event.currentTarget);
  }, [clearTimer, releasePointer]);
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    clearTimer();
    longPressed.current = false;
    releasePointer(event.currentTarget);
  }, [clearTimer, releasePointer]);
  const onPointerLeave = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    clearTimer();
    releasePointer(event.currentTarget);
  }, [clearTimer, releasePointer]);
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    suppressClick(event);
  }, [suppressClick]);
  const handleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (suppressClick(event)) return;
    onClick?.(event);
  }, [onClick, suppressClick]);

  return { onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, onContextMenu, onClick: handleClick, onClickCapture };
}
