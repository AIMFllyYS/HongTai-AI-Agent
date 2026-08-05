import { Icon, type IconName } from "./Icon";
import { pathForRoute, type RouteKey } from "../router";

interface NavItem {
  readonly id: "ai" | "home" | "create" | "assets" | "settings";
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

const navItems: readonly NavItem[] = [
  { id: "ai", label: "AI", icon: "health_cross", path: "/vitality/scan" },
  { id: "home", label: "拆解", icon: "analytics", path: pathForRoute("home") },
  { id: "create", label: "制作", icon: "movie_edit", path: pathForRoute("create") },
  { id: "assets", label: "素材", icon: "folder_open", path: pathForRoute("assets") },
  { id: "settings", label: "设置", icon: "settings", path: pathForRoute("settings") },
];

export interface BottomNavProps {
  readonly active?: "ai" | "home" | "create" | "assets" | "settings";
  readonly navigate: (path: string) => void;
}

export function BottomNav({ active, navigate }: BottomNavProps) {
  return (
    <nav aria-label="主导航" className="bottom-nav">
      {navItems.map((item) => {
        const selected = item.id === active;
        return (
          <a
            aria-current={selected ? "page" : undefined}
            className={`bottom-nav__item bottom-nav__item--${item.id} ${selected ? "is-active" : ""}`.trim()}
            href={item.path}
            key={item.id}
            onClick={(event) => {
              event.preventDefault();
              navigate(item.path);
            }}
          >
            <span className="bottom-nav__icon-wrap"><Icon name={item.icon} size={22} /></span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

export function activeNavForRoute(route: RouteKey): BottomNavProps["active"] {
  if (route === "vitality-scan" || route === "vitality-result") return "ai";
  if (route === "create") return "create";
  if (route === "assets") return "assets";
  if (route === "settings") return "settings";
  if (route === "home" || route === "processing" || route === "analysis-result" || route === "video-detail" || route === "gallery-detail") return "home";
  return undefined;
}
