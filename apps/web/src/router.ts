export type PrimaryNavKey = "ai" | "home" | "create" | "templates" | "settings";

/** Routes that have an actively supported page in the local application. */
export type ActiveRouteKey =
  | "home"
  | "task-processing"
  | "task-detail"
  | "task-analysis"
  | "create"
  | "production-edit"
  | "replica-wizard"
  | "templates"
  | "settings"
  | "settings-profile"
  | "settings-ai"
  | "settings-app-info"
  | "settings-update-log"
  | "observation-new"
  | "observation-report"
  | "playbook";

export type RouteKey = ActiveRouteKey | "not-found";
export type RouteParams = Readonly<Record<string, string>>;

export interface AppRoute {
  /** Canonical static path or parameterized route pattern. */
  readonly path: string;
  readonly key: ActiveRouteKey;
  readonly navKey?: PrimaryNavKey;
  /**
   * Hosted primary tab bar. Default true.
   * Detail routes set false so App can unmount the portal BottomNav;
   * AppShell still uses the matching `showNav` prop for content padding.
   */
  readonly showNav?: boolean;
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

export type NavigationTransition = "primary" | "push" | "instant";

export interface NavigateOptions {
  readonly transition?: NavigationTransition;
  readonly scroll?: ScrollBehavior;
}

export type Navigate = (path: string, options?: NavigateOptions) => void;

export const taskPageAliasKeys = ["task-processing", "task-detail", "task-analysis"] as const;
export type TaskPageAliasKey = (typeof taskPageAliasKeys)[number];

export function isTaskPageAlias(key: RouteKey): key is TaskPageAliasKey {
  return (taskPageAliasKeys as readonly string[]).includes(key);
}

export const appRoutes: readonly AppRoute[] = [
  { path: "/", key: "home", navKey: "home" },
  { path: "/tasks/:taskId/processing", key: "task-processing", navKey: "home" },
  { path: "/tasks/:taskId", key: "task-detail", navKey: "home" },
  { path: "/tasks/:taskId/analysis", key: "task-analysis", navKey: "home" },
  { path: "/create", key: "create", navKey: "create" },
  { path: "/create/:projectId/edit", key: "production-edit", navKey: "create" },
  { path: "/replica/:taskId", key: "replica-wizard", navKey: "create" },
  { path: "/templates", key: "templates", navKey: "templates" },
  { path: "/settings", key: "settings", navKey: "settings" },
  { path: "/settings/profile", key: "settings-profile", navKey: "settings" },
  { path: "/settings/ai", key: "settings-ai", navKey: "settings" },
  { path: "/settings/app-info", key: "settings-app-info", navKey: "settings" },
  { path: "/settings/app-info/updates", key: "settings-update-log", navKey: "settings" },
  { path: "/observation/new", key: "observation-new", navKey: "ai" },
  { path: "/observation/:sessionId", key: "observation-report", navKey: "ai", showNav: false },
  { path: "/playbook", key: "playbook" },
];

const EMPTY_ROUTE_PARAMS: RouteParams = Object.freeze({});

interface DynamicRouteDefinition {
  readonly key: Extract<ActiveRouteKey, "task-processing" | "task-detail" | "task-analysis" | "observation-report" | "production-edit" | "replica-wizard" | "playbook">;
  readonly pattern: string;
  readonly navKey?: PrimaryNavKey;
  readonly matcher: RegExp;
  readonly paramName: "taskId" | "sessionId" | "projectId" | "sectionId";
}

const dynamicRoutes: readonly DynamicRouteDefinition[] = [
  {
    key: "playbook",
    pattern: "/playbook/:sectionId",
    matcher: /^\/playbook\/([^/]+)$/u,
    paramName: "sectionId",
  },
  {
    key: "production-edit",
    pattern: "/create/:projectId/edit",
    navKey: "create",
    matcher: /^\/create\/([^/]+)\/edit$/u,
    paramName: "projectId",
  },
  {
    key: "replica-wizard",
    pattern: "/replica/:taskId",
    navKey: "create",
    matcher: /^\/replica\/([^/]+)$/u,
    paramName: "taskId",
  },
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

export interface LocationHrefParts {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** Splits a navigation target so query and hash never participate in route matching. */
export function splitLocationHref(href: string): LocationHrefParts {
  const trimmed = href.trim();
  if (!trimmed) return { pathname: "/", search: "", hash: "" };
  const hashIndex = trimmed.indexOf("#");
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const searchIndex = withoutHash.indexOf("?");
  const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : "";
  const rawPath = searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
  return { pathname: rawPath || "/", search, hash };
}

function normalizePath(pathname: string): string {
  const pathOnly = splitLocationHref(pathname).pathname;
  if (!pathOnly || pathOnly === "/") return "/";
  const path = pathOnly.replace(/\/+$/, "");
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
 * Primary tab bar is on for tab roots; detail routes opt out in `appRoutes`.
 */
export function showsPrimaryNav(key: RouteKey): boolean {
  if (key === "not-found") return true;
  return appRoutes.find((route) => route.key === key)?.showNav !== false;
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

export function productionEditPath(projectId: string): string {
  return `/create/${encodedPathSegment(projectId)}/edit`;
}

export function replicaWizardPath(taskId: string): string {
  return `/replica/${encodedPathSegment(taskId)}`;
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

export function updateLogSettingsPath(): string {
  return "/settings/app-info/updates";
}

export function observationNewPath(): string {
  return "/observation/new";
}

export function observationReportPath(sessionId: string): string {
  return `/observation/${encodedPathSegment(sessionId)}`;
}

export function playbookPath(): string {
  return "/playbook";
}

export function playbookSectionPath(sectionId: string): string {
  return `/playbook/${encodedPathSegment(sectionId)}`;
}

const primaryNavigationOrder = ["ai", "home", "templates", "settings"] as const;

function swipeNavIndex(navKey: PrimaryNavKey | undefined): number {
  if (!navKey || navKey === "create") return -1;
  return primaryNavigationOrder.indexOf(navKey);
}

function routeIndex(route: MatchedAppRoute): number {
  if (route.key === "not-found") return -1;
  return appRoutes.findIndex((candidate) => candidate.key === route.key);
}

export function routeTransitionDirection(fromPath: string, toPath: string): "forward" | "backward" {
  const fromRoute = matchRoute(fromPath);
  const toRoute = matchRoute(toPath);
  const fromNavIndex = fromRoute.key === "not-found" ? -1 : swipeNavIndex(fromRoute.navKey);
  const toNavIndex = toRoute.key === "not-found" ? -1 : swipeNavIndex(toRoute.navKey);

  if (fromNavIndex >= 0 && toNavIndex >= 0 && fromNavIndex !== toNavIndex) {
    return toNavIndex > fromNavIndex ? "forward" : "backward";
  }

  return routeIndex(toRoute) >= routeIndex(fromRoute) ? "forward" : "backward";
}
