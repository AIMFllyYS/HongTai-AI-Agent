export type RouteKey =
  | "home"
  | "processing"
  | "analysis-result"
  | "video-detail"
  | "gallery-detail"
  | "create"
  | "publish"
  | "assets"
  | "settings"
  | "vitality-scan"
  | "vitality-result"
  | "not-found";

export interface AppRoute {
  readonly path: string;
  readonly key: Exclude<RouteKey, "not-found">;
  readonly navKey?: "home" | "create" | "assets" | "settings";
}

export const appRoutes: readonly AppRoute[] = [
  { path: "/", key: "home", navKey: "home" },
  { path: "/analyze/processing", key: "processing", navKey: "home" },
  { path: "/analyze/result", key: "analysis-result", navKey: "home" },
  { path: "/analyze/detail/video", key: "video-detail", navKey: "home" },
  { path: "/analyze/detail/gallery", key: "gallery-detail", navKey: "home" },
  { path: "/create", key: "create", navKey: "create" },
  { path: "/publish", key: "publish" },
  { path: "/assets", key: "assets", navKey: "assets" },
  { path: "/settings", key: "settings", navKey: "settings" },
  { path: "/vitality/scan", key: "vitality-scan" },
  { path: "/vitality/result", key: "vitality-result" },
];

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

export function matchRoute(pathname: string): AppRoute | { readonly path: string; readonly key: "not-found" } {
  const normalized = normalizePath(pathname);
  return appRoutes.find((route) => route.path === normalized) ?? { path: normalized, key: "not-found" };
}

export function pathForRoute(key: RouteKey): string {
  return appRoutes.find((route) => route.key === key)?.path ?? "/";
}
