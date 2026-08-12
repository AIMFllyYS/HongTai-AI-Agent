export type PrimaryNavKey = "ai" | "home" | "create" | "templates" | "settings";

/** Routes that have an actively supported page in the local application. */
export type ActiveRouteKey =
  | "home"
  | "task-processing"
  | "task-detail"
  | "task-analysis"
  | "create"
  | "publish"
  | "templates"
  | "settings"
  | "settings-profile"
  | "settings-ai"
  | "settings-app-info"
  | "observation-new"
  | "observation-report";

/**
 * Kept temporarily so the current page shell can be migrated independently of
 * the router. No route definition resolves to one of these keys.
 */
export type LegacyRouteKey =
  | "processing"
  | "analysis-result"
  | "video-detail"
  | "gallery-detail"
  | "vitality-scan"
  | "vitality-result";

export type RouteKey = ActiveRouteKey | LegacyRouteKey | "not-found";
export type RouteParams = Readonly<Record<string, string>>;

export interface AppRoute {
  /** Canonical static path or parameterized route pattern. */
  readonly path: string;
  readonly key: ActiveRouteKey;
  readonly navKey?: PrimaryNavKey;
}

export interface MatchedRoute {
  /** The normalized path that was matched, never a route pattern. */
  readonly path: string;
  /** The canonical pattern for the route definition. */
  readonly pattern: string;
  readonly key: Exclude<RouteKey, "not-found">;
  readonly navKey?: PrimaryNavKey;
  readonly params: RouteParams;
}

export interface NotFoundRoute {
  readonly path: string;
  readonly pattern: undefined;
  readonly key: "not-found";
  readonly params: RouteParams;
}

export type MatchedAppRoute = MatchedRoute | NotFoundRoute;

export type NavigationTransition = "animated" | "instant";

export interface NavigateOptions {
  readonly transition?: NavigationTransition;
  readonly scroll?: ScrollBehavior;
}

export type Navigate = (path: string, options?: NavigateOptions) => void;

export const appRoutes: readonly AppRoute[] = [
  { path: "/", key: "home", navKey: "home" },
  { path: "/tasks/:taskId/processing", key: "task-processing", navKey: "home" },
  { path: "/tasks/:taskId", key: "task-detail", navKey: "home" },
  { path: "/tasks/:taskId/analysis", key: "task-analysis", navKey: "home" },
  { path: "/create", key: "create", navKey: "create" },
  { path: "/publish", key: "publish" },
  { path: "/templates", key: "templates", navKey: "templates" },
  { path: "/settings", key: "settings", navKey: "settings" },
  { path: "/settings/profile", key: "settings-profile", navKey: "settings" },
  { path: "/settings/ai", key: "settings-ai", navKey: "settings" },
  { path: "/settings/app-info", key: "settings-app-info", navKey: "settings" },
  { path: "/observation/new", key: "observation-new", navKey: "ai" },
  { path: "/observation/:sessionId", key: "observation-report", navKey: "ai" },
];

const EMPTY_ROUTE_PARAMS: RouteParams = Object.freeze({});

interface DynamicRouteDefinition {
  readonly key: Extract<ActiveRouteKey, "task-processing" | "task-detail" | "task-analysis" | "observation-report">;
  readonly pattern: string;
  readonly navKey: PrimaryNavKey;
  readonly matcher: RegExp;
  readonly paramName: "taskId" | "sessionId";
}

const dynamicRoutes: readonly DynamicRouteDefinition[] = [
  {
    key: "task-processing",
    pattern: "/tasks/:taskId/processing",
    navKey: "home",
    matcher: /^\/tasks\/([^/]+)\/processing$/u,
    paramName: "taskId",
  },
  {
    key: "task-analysis",
    pattern: "/tasks/:taskId/analysis",
    navKey: "home",
    matcher: /^\/tasks\/([^/]+)\/analysis$/u,
    paramName: "taskId",
  },
  {
    key: "task-detail",
    pattern: "/tasks/:taskId",
    navKey: "home",
    matcher: /^\/tasks\/([^/]+)$/u,
    paramName: "taskId",
  },
  {
    key: "observation-report",
    pattern: "/observation/:sessionId",
    navKey: "ai",
    matcher: /^\/observation\/([^/]+)$/u,
    paramName: "sessionId",
  },
];

/** The old scan entry is harmless because it has no report/session identifier. */
const legacyAliases: Readonly<Record<string, Pick<AppRoute, "key" | "navKey">>> = {
  "/assets": { key: "templates", navKey: "templates" },
  "/vitality/scan": { key: "observation-new", navKey: "ai" },
};

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

function decodeRouteParam(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function matchedStaticRoute(route: AppRoute, path: string): MatchedRoute {
  return { path, pattern: route.path, key: route.key, navKey: route.navKey, params: EMPTY_ROUTE_PARAMS };
}

function matchedDynamicRoute(route: DynamicRouteDefinition, path: string, value: string): MatchedRoute | undefined {
  const decoded = decodeRouteParam(value);
  if (!decoded) return undefined;
  return {
    path,
    pattern: route.pattern,
    key: route.key,
    navKey: route.navKey,
    params: { [route.paramName]: decoded },
  };
}

export function matchRoute(pathname: string): MatchedAppRoute {
  const normalized = normalizePath(pathname);
  const staticRoute = appRoutes.find((route) => !route.path.includes(":") && route.path === normalized);
  if (staticRoute) return matchedStaticRoute(staticRoute, normalized);

  const alias = legacyAliases[normalized];
  if (alias) return { path: normalized, pattern: "/observation/new", key: alias.key, navKey: alias.navKey, params: EMPTY_ROUTE_PARAMS };

  for (const route of dynamicRoutes) {
    const match = route.matcher.exec(normalized);
    const value = match?.[1];
    if (value) {
      const matched = matchedDynamicRoute(route, normalized, value);
      if (matched) return matched;
    }
  }

  return { path: normalized, pattern: undefined, key: "not-found", params: EMPTY_ROUTE_PARAMS };
}

/**
 * Returns a canonical non-parameterized path. Dynamic routes must use their
 * named builders below so opaque IDs are always encoded.
 */
export function pathForRoute(key: RouteKey): string {
  const route = appRoutes.find((candidate) => candidate.key === key && !candidate.path.includes(":"));
  return route?.path ?? "/";
}

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function taskProcessingPath(taskId: string): string {
  return `/tasks/${encodedPathSegment(taskId)}/processing`;
}

export function taskDetailPath(taskId: string): string {
  return `/tasks/${encodedPathSegment(taskId)}`;
}

export function taskAnalysisPath(taskId: string): string {
  return `/tasks/${encodedPathSegment(taskId)}/analysis`;
}

export function profileSettingsPath(): string {
  return "/settings/profile";
}

export function aiSettingsPath(): string {
  return "/settings/ai";
}

export function appInfoSettingsPath(): string {
  return "/settings/app-info";
}

export function observationNewPath(): string {
  return "/observation/new";
}

export function observationReportPath(sessionId: string): string {
  return `/observation/${encodedPathSegment(sessionId)}`;
}

const primaryNavigationOrder = ["ai", "home", "create", "templates", "settings"] as const;

function routeIndex(route: MatchedAppRoute): number {
  if (route.key === "not-found") return -1;
  return appRoutes.findIndex((candidate) => candidate.key === route.key);
}

export function routeTransitionDirection(fromPath: string, toPath: string): "forward" | "backward" {
  const fromRoute = matchRoute(fromPath);
  const toRoute = matchRoute(toPath);
  const fromNavIndex = fromRoute.key === "not-found" || !fromRoute.navKey ? -1 : primaryNavigationOrder.indexOf(fromRoute.navKey);
  const toNavIndex = toRoute.key === "not-found" || !toRoute.navKey ? -1 : primaryNavigationOrder.indexOf(toRoute.navKey);

  if (fromNavIndex >= 0 && toNavIndex >= 0 && fromNavIndex !== toNavIndex) {
    return toNavIndex > fromNavIndex ? "forward" : "backward";
  }

  return routeIndex(toRoute) >= routeIndex(fromRoute) ? "forward" : "backward";
}
