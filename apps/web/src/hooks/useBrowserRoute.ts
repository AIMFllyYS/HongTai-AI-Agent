import { useCallback, useEffect, useState } from "react";

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function useBrowserRoute() {
  const [pathname, setPathname] = useState(currentPath);

  useEffect(() => {
    const update = () => setPathname(currentPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((path: string) => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === path) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.history.pushState({}, "", path);
    setPathname(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return { pathname, navigate };
}
