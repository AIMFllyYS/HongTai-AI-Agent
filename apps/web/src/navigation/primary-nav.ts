import type { IconName } from "../components/Icon";
import { pathForRoute } from "../router";

export type PrimaryNavId = "ai" | "home" | "create" | "templates" | "settings";

export interface PrimaryNavItem {
  readonly id: PrimaryNavId;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

export type PrimaryNavDirection = "next" | "previous";

export const primaryNavItems: readonly PrimaryNavItem[] = [
  { id: "ai", label: "AI", icon: "health_cross", path: pathForRoute("observation-new") },
  { id: "home", label: "拆解", icon: "analytics", path: pathForRoute("home") },
  { id: "create", label: "制作", icon: "movie_edit", path: pathForRoute("create") },
  { id: "templates", label: "模板", icon: "content_paste", path: pathForRoute("templates") },
  { id: "settings", label: "设置", icon: "settings", path: pathForRoute("settings") },
];

export function adjacentPrimaryNavPath(active: PrimaryNavId | undefined, direction: PrimaryNavDirection): string | undefined {
  if (!active) return undefined;
  const currentIndex = primaryNavItems.findIndex((item) => item.id === active);
  if (currentIndex < 0) return undefined;
  const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
  return primaryNavItems[nextIndex]?.path;
}
