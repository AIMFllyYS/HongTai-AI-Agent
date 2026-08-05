import { useCallback, useRef, useState } from "react";
import type { PointerEvent, PointerEventHandler } from "react";
import type { BottomNavProps } from "../components/BottomNav";
import { primaryNavItems } from "../navigation/primary-nav";
import type { Navigate } from "../router";

const SWIPE_DISTANCE = 56;
const SWIPE_DIRECTION_RATIO = 1.25;
const SWIPE_LOCK_DISTANCE = 8;
const MAX_DRAG_OFFSET = 128;

type PointerDirection = "horizontal" | "vertical" | null;

interface PointerOrigin {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  direction: PointerDirection;
}

export interface SwipeNavigationHandlers {
  readonly onPointerDown: PointerEventHandler<HTMLElement>;
  readonly onPointerMove: PointerEventHandler<HTMLElement>;
  readonly onPointerUp: PointerEventHandler<HTMLElement>;
  readonly onPointerCancel: PointerEventHandler<HTMLElement>;
  readonly swipeOffset: number;
  readonly isDragging: boolean;
}

function isSwipeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role=\"button\"], [data-feedback], [data-no-swipe]"));
}

function isSupportedPointer(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "touch" || pointerType === "pen";
}

function clampDragOffset(offset: number): number {
  return Math.max(-MAX_DRAG_OFFSET, Math.min(MAX_DRAG_OFFSET, offset));
}

export function useSwipeNavigation(active: BottomNavProps["active"], navigate: Navigate): SwipeNavigationHandlers {
  const origin = useRef<PointerOrigin | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const clearGesture = useCallback((event?: PointerEvent<HTMLElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    origin.current = null;
    setSwipeOffset(0);
    setIsDragging(false);
  }, []);

  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (!active || !isSupportedPointer(event.pointerType) || (event.pointerType === "mouse" && event.button !== 0) || isSwipeTarget(event.target)) {
      clearGesture();
      return;
    }

    origin.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      direction: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic audit events do not have an active pointer; real browser events still capture normally.
    }
  }, [active, clearGesture]);

  const onPointerMove = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const start = origin.current;
    if (!start || start.pointerId !== event.pointerId || start.pointerType !== event.pointerType || start.direction === "vertical") return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.direction === null) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_LOCK_DISTANCE) return;
      if (Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_DIRECTION_RATIO) {
        start.direction = "horizontal";
      } else if (Math.abs(deltaY) > Math.abs(deltaX) * SWIPE_DIRECTION_RATIO) {
        start.direction = "vertical";
        return;
      } else {
        return;
      }
    }

    setIsDragging(true);
    setSwipeOffset(clampDragOffset(deltaX));
  }, []);

  const onPointerUp = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const start = origin.current;
    if (!start || start.pointerId !== event.pointerId || start.pointerType !== event.pointerType) {
      clearGesture(event);
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isHorizontalSwipe = Math.abs(deltaX) >= SWIPE_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_DIRECTION_RATIO;
    const currentIndex = primaryNavItems.findIndex((item) => item.id === active);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextItem = currentIndex >= 0 ? primaryNavItems[nextIndex] : undefined;

    clearGesture(event);
    if (!isHorizontalSwipe || !nextItem) return;

    navigate(nextItem.path);
  }, [active, clearGesture, navigate]);

  const onPointerCancel = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    clearGesture(event);
  }, [clearGesture]);

  return { isDragging, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, swipeOffset };
}
