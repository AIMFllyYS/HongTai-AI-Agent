import type { IconName } from "../components/Icon";
import { pathForRoute } from "../router";

export type PrimaryNavId = "ai" | "home" | "create" | "templates" | "settings";
export type SwipeNavId = Exclude<PrimaryNavId, "create">;

export interface PrimaryNavItem {
  readonly id: SwipeNavId;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

export type PrimaryNavDirection = "next" | "previous";

/** Four swipe destinations. The center plus is not a swipe target. */
export const primaryNavItems: readonly PrimaryNavItem[] = [
  { id: "ai", label: "观察", icon: "scan_face", path: pathForRoute("observation-new") },
  { id: "home", label: "拆解", icon: "layers", path: pathForRoute("home") },
  { id: "templates", label: "模板", icon: "layout_template", path: pathForRoute("templates") },
  { id: "settings", label: "设置", icon: "settings", path: pathForRoute("settings") },
];

export function adjacentPrimaryNavPath(active: PrimaryNavId | undefined, direction: PrimaryNavDirection): string | undefined {
  if (!active || active === "create") return undefined;
  const currentIndex = primaryNavItems.findIndex((item) => item.id === active);
  if (currentIndex < 0) return undefined;
  const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
  return primaryNavItems[nextIndex]?.path;
}
