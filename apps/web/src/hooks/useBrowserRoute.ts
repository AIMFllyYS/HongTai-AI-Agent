import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteTransitionDirection } from "../motion/tokens";
import { routeTransitionDirection, type Navigate, type NavigateOptions, type NavigationTransition } from "../router";

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function scrollToTop(preferredBehavior?: ScrollBehavior): void {
  if (typeof window === "undefined") return;
  const behavior = preferredBehavior ?? (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth");
  window.scrollTo({ top: 0, behavior });
}

export function useBrowserRoute() {
  const [pathname, setPathname] = useState(currentPath);
  const [direction, setDirection] = useState<RouteTransitionDirection>("forward");
  const [transitionMode, setTransitionMode] = useState<NavigationTransition>("animated");
  const previousPath = useRef(pathname);

  useEffect(() => {
    const update = () => {
      const nextPath = currentPath();
      setTransitionMode("animated");
      setDirection(routeTransitionDirection(previousPath.current, nextPath));
      previousPath.current = nextPath;
      setPathname(nextPath);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback<Navigate>((path: string, options: NavigateOptions = {}) => {
    if (typeof window === "undefined") return;
    const transition = options.transition ?? "animated";
    const scrollBehavior = options.scroll ?? (transition === "instant" ? "auto" : undefined);
    setTransitionMode(transition);
    if (window.location.pathname === path) {
      scrollToTop(scrollBehavior);
      return;
    }
    setDirection(routeTransitionDirection(previousPath.current, path));
    previousPath.current = path;
    window.history.pushState({}, "", path);
    setPathname(path);
    scrollToTop(scrollBehavior);
  }, []);

  return { pathname, direction, transitionMode, navigate };
}
