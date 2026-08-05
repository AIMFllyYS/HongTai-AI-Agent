import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteTransitionDirection } from "../motion/tokens";
import { routeTransitionDirection } from "../router";

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function scrollToTop(): void {
  if (typeof window === "undefined") return;
  const behavior = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  window.scrollTo({ top: 0, behavior });
}

export function useBrowserRoute() {
  const [pathname, setPathname] = useState(currentPath);
  const [direction, setDirection] = useState<RouteTransitionDirection>("forward");
  const previousPath = useRef(pathname);

  useEffect(() => {
    const update = () => {
      const nextPath = currentPath();
      setDirection(routeTransitionDirection(previousPath.current, nextPath));
      previousPath.current = nextPath;
      setPathname(nextPath);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((path: string) => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === path) {
      scrollToTop();
      return;
    }
    setDirection(routeTransitionDirection(previousPath.current, path));
    previousPath.current = path;
    window.history.pushState({}, "", path);
    setPathname(path);
    scrollToTop();
  }, []);

  return { pathname, direction, navigate };
}
