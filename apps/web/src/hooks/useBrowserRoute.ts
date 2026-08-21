import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteTransitionDirection } from "../motion/tokens";
import { routeTransitionDirection, splitLocationHref, type Navigate, type NavigateOptions, type NavigationTransition } from "../router";

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function currentHref(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash ?? ""}`;
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
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [direction, setDirection] = useState<RouteTransitionDirection>("forward");
  const [transitionMode, setTransitionMode] = useState<NavigationTransition>("push");
  const previousPath = useRef(pathname);
  const previousSearch = useRef(currentSearch());

  const applyLocation = useCallback((nextPathname: string, nextSearch: string, transition: NavigationTransition) => {
    const pathnameChanged = previousPath.current !== nextPathname;
    const searchChanged = previousSearch.current !== nextSearch;
    if (!pathnameChanged && !searchChanged) return;
    setTransitionMode(transition);
    if (pathnameChanged) {
      setDirection(routeTransitionDirection(previousPath.current, nextPathname));
      previousPath.current = nextPathname;
      setPathname(nextPathname);
    }
    if (searchChanged) {
      previousSearch.current = nextSearch;
      setSearchEpoch((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      applyLocation(currentPath(), currentSearch(), "push");
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [applyLocation]);

  const navigate = useCallback<Navigate>((path: string, options: NavigateOptions = {}) => {
    if (typeof window === "undefined") return;
    const transition = options.transition ?? "push";
    const scrollBehavior = options.scroll ?? (transition === "instant" ? "auto" : undefined);
    const { pathname: nextPathname, search: nextSearch, hash: nextHash } = splitLocationHref(path);
    const href = `${nextPathname}${nextSearch}${nextHash}`;
    setTransitionMode(transition);
    if (currentHref() === href) {
      scrollToTop(scrollBehavior);
      return;
    }
    window.history.pushState({}, "", href);
    applyLocation(nextPathname, nextSearch, transition);
    scrollToTop(scrollBehavior);
  }, [applyLocation]);

  return { pathname, direction, transitionMode, navigate, searchEpoch };
}
