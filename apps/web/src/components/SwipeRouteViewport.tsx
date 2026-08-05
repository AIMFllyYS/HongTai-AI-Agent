import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, TransitionEventHandler } from "react";
import type { BottomNavProps } from "./BottomNav";
import { adjacentPrimaryNavPath } from "../navigation/primary-nav";
import { motionDurations } from "../motion/tokens";
import type { Navigate } from "../router";
import { useSwipeNavigation, type SwipeCommit } from "../hooks/useSwipeNavigation";

export interface SwipeRouteViewportProps {
  readonly active: BottomNavProps["active"];
  readonly currentPath: string;
  readonly navigate: Navigate;
  readonly renderRoute: (path: string) => ReactNode;
  readonly children: ReactNode;
}

export function SwipeRouteViewport({ active, currentPath, navigate, renderRoute, children }: SwipeRouteViewportProps) {
  const [pendingSwipe, setPendingSwipe] = useState<SwipeCommit | null>(null);
  const [pendingSourcePath, setPendingSourcePath] = useState<string | null>(null);
  const hasCommittedPending = useRef(false);
  const commitSwipe = useCallback((commit: SwipeCommit) => {
    hasCommittedPending.current = false;
    setPendingSourcePath(currentPath);
    setPendingSwipe(commit);
  }, [currentPath]);
  const { isDragging, isSettling, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, swipeOffset } = useSwipeNavigation(active, navigate, { onCommit: commitSwipe });

  const pendingPath = pendingSwipe?.path;
  const isPendingRoute = pendingPath === currentPath;
  const isGestureActive = isDragging || isSettling || Boolean(pendingSwipe && !isPendingRoute);
  const swipeDirection = swipeOffset < 0 ? "next" : "previous";
  const previousPath = adjacentPrimaryNavPath(active, "previous");
  const nextPath = adjacentPrimaryNavPath(active, "next");
  const targetPath = pendingPath ?? (isGestureActive ? (swipeDirection === "next" ? nextPath : previousPath) : undefined);
  const candidate = targetPath ? renderRoute(targetPath) : null;
  const edgeCopy = isGestureActive && !targetPath ? renderRoute(currentPath) : null;
  const previousPane = targetPath === previousPath ? candidate : swipeDirection === "previous" ? edgeCopy : null;
  const nextPane = targetPath === nextPath ? candidate : swipeDirection === "next" ? edgeCopy : null;
  const effectiveOffset = isPendingRoute ? 0 : swipeOffset;
  const trackStyle = { "--swipe-offset": `${effectiveOffset}px` } as CSSProperties;
  const trackClassName = [
    "route-swipe-track",
    isDragging ? "route-swipe-track--dragging" : "",
    isGestureActive && !isDragging ? "route-swipe-track--settling" : "",
  ].filter(Boolean).join(" ");

  const finishPendingSwipe = useCallback(() => {
    if (!pendingSwipe || pendingSwipe.path === currentPath || hasCommittedPending.current) return;
    hasCommittedPending.current = true;
    navigate(pendingSwipe.path, { scroll: "auto", transition: "instant" });
  }, [currentPath, navigate, pendingSwipe]);

  useEffect(() => {
    if (pendingSwipe?.path === currentPath) {
      setPendingSwipe(null);
      setPendingSourcePath(null);
    } else if (pendingSwipe && pendingSourcePath !== currentPath) {
      setPendingSwipe(null);
      setPendingSourcePath(null);
    }
  }, [currentPath, pendingSourcePath, pendingSwipe]);

  useEffect(() => {
    if (!pendingSwipe || pendingSwipe.path === currentPath || typeof window === "undefined") return;
    const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fallbackDelay = prefersReducedMotion ? 40 : motionDurations.standard + 40;
    const timer = window.setTimeout(finishPendingSwipe, fallbackDelay);
    return () => window.clearTimeout(timer);
  }, [currentPath, finishPendingSwipe, pendingSwipe]);

  const handleTransitionEnd = useCallback<TransitionEventHandler<HTMLDivElement>>((event) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    finishPendingSwipe();
  }, [finishPendingSwipe]);

  return (
    <div className="route-swipe-viewport" data-swipe-state={isDragging ? "dragging" : isGestureActive ? "settling" : "idle"} data-swipe-target={targetPath ?? undefined} {...{ onPointerCancel, onPointerDown, onPointerMove, onPointerUp }}>
      <div className={trackClassName} onTransitionEnd={handleTransitionEnd} style={trackStyle}>
        <div className="route-swipe-pane" key={`previous-${previousPath ?? "empty"}`}>{previousPane}</div>
        <div className="route-swipe-pane route-swipe-pane--current" key={`current-${currentPath}`}>{children}</div>
        <div className="route-swipe-pane" key={`next-${nextPath ?? "empty"}`}>{nextPane}</div>
      </div>
    </div>
  );
}
