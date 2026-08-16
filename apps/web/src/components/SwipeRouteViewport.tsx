import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, TransitionEventHandler } from "react";
import type { BottomNavProps } from "./BottomNav";
import { visualThemeForRoute } from "./AppShell";
import { adjacentPrimaryNavPath } from "../navigation/primary-nav";
import { motionDurations } from "../motion/tokens";
import { matchRoute, type Navigate } from "../router";
import { useSwipeNavigation, type SwipeCommit } from "../hooks/useSwipeNavigation";

function SwipeRoutePreviewPane({ path }: { readonly path: string }) {
  return (
    <div
      aria-hidden="true"
      className="app-shell app-shell--with-nav route-swipe-preview"
      data-visual-theme={visualThemeForRoute(matchRoute(path).key)}
    />
  );
}

export interface SwipeRouteViewportProps {
  readonly active: BottomNavProps["active"];
  readonly currentPath: string;
  readonly navigate: Navigate;
  readonly children: ReactNode;
}

export function SwipeRouteViewport({ active, currentPath, navigate, children }: SwipeRouteViewportProps) {
  const [pendingSwipe, setPendingSwipe] = useState<SwipeCommit | null>(null);
  const [pendingSourcePath, setPendingSourcePath] = useState<string | null>(null);
  const [routeCommitPath, setRouteCommitPath] = useState<string | null>(null);
  const hasCommittedPending = useRef(false);
  const commitSwipe = useCallback((commit: SwipeCommit) => {
    hasCommittedPending.current = false;
    setPendingSourcePath(currentPath);
    setPendingSwipe(commit);
  }, [currentPath]);
  const { isDragging, isSettling, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, swipeOffset } = useSwipeNavigation(active, navigate, { onCommit: commitSwipe });

  const pendingPath = pendingSwipe?.path;
  const isPendingRoute = pendingPath === currentPath;
  const isRouteCommit = isPendingRoute || routeCommitPath === currentPath;
  const isGestureActive = isDragging || isSettling || Boolean(pendingSwipe && !isPendingRoute);
  const swipeDirection = swipeOffset < 0 ? "next" : "previous";
  const previousPath = adjacentPrimaryNavPath(active, "previous");
  const nextPath = adjacentPrimaryNavPath(active, "next");
  const targetPath = pendingPath ?? (isGestureActive ? (swipeDirection === "next" ? nextPath : previousPath) : undefined);
  const previewPath = targetPath ?? (isGestureActive ? currentPath : undefined);
  const previewPane = previewPath ? <SwipeRoutePreviewPane path={previewPath} /> : null;
  const previousPane = targetPath === previousPath || (!targetPath && swipeDirection === "previous") ? previewPane : null;
  const nextPane = targetPath === nextPath || (!targetPath && swipeDirection === "next") ? previewPane : null;
  const effectiveOffset = isRouteCommit ? 0 : swipeOffset;
  const trackStyle = { "--swipe-offset": `${effectiveOffset}px` } as CSSProperties;
  const trackClassName = [
    "route-swipe-track",
    isDragging ? "route-swipe-track--dragging" : "",
    isGestureActive && !isDragging ? "route-swipe-track--settling" : "",
    isRouteCommit ? "route-swipe-track--route-commit" : "",
  ].filter(Boolean).join(" ");

  const finishPendingSwipe = useCallback(() => {
    if (!pendingSwipe || pendingSwipe.path === currentPath || hasCommittedPending.current) return;
    hasCommittedPending.current = true;
    navigate(pendingSwipe.path, { scroll: "auto", transition: "instant" });
  }, [currentPath, navigate, pendingSwipe]);

  useEffect(() => {
    if (pendingSwipe?.path === currentPath) {
      const committedPath = currentPath;
      setRouteCommitPath(committedPath);
      setPendingSwipe(null);
      setPendingSourcePath(null);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          setRouteCommitPath((activePath) => activePath === committedPath ? null : activePath);
        });
      }
    } else if (pendingSwipe && pendingSourcePath !== currentPath) {
      setRouteCommitPath(null);
      setPendingSwipe(null);
      setPendingSourcePath(null);
    } else if (routeCommitPath && routeCommitPath !== currentPath) {
      setRouteCommitPath(null);
    }
  }, [currentPath, pendingSourcePath, pendingSwipe, routeCommitPath]);

  useEffect(() => {
    if (!pendingSwipe || pendingSwipe.path === currentPath || typeof window === "undefined") return;
    const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fallbackDelay = prefersReducedMotion ? 40 : motionDurations.standard + 40;
    const timer = window.setTimeout(finishPendingSwipe, fallbackDelay);
    return () => window.clearTimeout(timer);
  }, [currentPath, finishPendingSwipe, pendingSwipe]);

  const handleTransitionEnd = useCallback<TransitionEventHandler<HTMLDivElement>>((event) => {
    if (event.target !== event.currentTarget || event.propertyName !== "left") return;
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
