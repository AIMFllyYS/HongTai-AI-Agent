import type { IconName } from "../components/Icon";
import { pathForRoute } from "../router";

export type PrimaryNavId = "ai" | "home" | "create" | "assets" | "settings";

export interface PrimaryNavItem {
  readonly id: PrimaryNavId;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

export const primaryNavItems: readonly PrimaryNavItem[] = [
  { id: "ai", label: "AI", icon: "health_cross", path: "/vitality/scan" },
  { id: "home", label: "拆解", icon: "analytics", path: pathForRoute("home") },
  { id: "create", label: "制作", icon: "movie_edit", path: pathForRoute("create") },
  { id: "assets", label: "素材", icon: "folder_open", path: pathForRoute("assets") },
  { id: "settings", label: "设置", icon: "settings", path: pathForRoute("settings") },
];
