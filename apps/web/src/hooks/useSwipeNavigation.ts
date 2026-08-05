import { useCallback, useRef } from "react";
import type { PointerEventHandler } from "react";
import type { BottomNavProps } from "../components/BottomNav";
import { primaryNavItems } from "../navigation/primary-nav";

const SWIPE_DISTANCE = 56;
const SWIPE_DIRECTION_RATIO = 1.25;

interface PointerOrigin {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
}

export interface SwipeNavigationHandlers {
  readonly onPointerDown: PointerEventHandler<HTMLElement>;
  readonly onPointerUp: PointerEventHandler<HTMLElement>;
  readonly onPointerCancel: PointerEventHandler<HTMLElement>;
}

function isSwipeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role=\"button\"], [data-feedback], [data-no-swipe]"));
}

export function useSwipeNavigation(active: BottomNavProps["active"], navigate: (path: string) => void): SwipeNavigationHandlers {
  const origin = useRef<PointerOrigin | null>(null);

  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (!active || (event.pointerType !== "touch" && event.pointerType !== "pen") || isSwipeTarget(event.target)) {
      origin.current = null;
      return;
    }

    origin.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    };
  }, [active]);

  const finishSwipe = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const start = origin.current;
    origin.current = null;
    if (!start || start.pointerId !== event.pointerId || start.pointerType !== event.pointerType) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY) * SWIPE_DIRECTION_RATIO) return;

    const currentIndex = primaryNavItems.findIndex((item) => item.id === active);
    if (currentIndex < 0) return;

    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextItem = primaryNavItems[nextIndex];
    if (nextItem) navigate(nextItem.path);
  }, [active, navigate]);

  const onPointerCancel = useCallback<PointerEventHandler<HTMLElement>>(() => {
    origin.current = null;
  }, []);

  return { onPointerDown, onPointerUp: finishSwipe, onPointerCancel };
}
