import { motion } from "motion/react";
import { Icon } from "./Icon";
import { type RouteKey } from "../router";
import { primaryNavItems } from "../navigation/primary-nav";

export interface BottomNavProps {
  readonly active?: "ai" | "home" | "create" | "assets" | "settings";
  readonly navigate: (path: string) => void;
}

export function BottomNav({ active, navigate }: BottomNavProps) {
  return (
    <nav aria-label="主导航" className="bottom-nav">
      {primaryNavItems.map((item) => {
        const selected = item.id === active;
        return (
          <motion.a
            aria-current={selected ? "page" : undefined}
            className={`bottom-nav__item bottom-nav__item--${item.id} ${selected ? "is-active" : ""}`.trim()}
            href={item.path}
            key={item.id}
            onClick={(event) => {
              event.preventDefault();
              navigate(item.path);
            }}
            transition={{ duration: 0.14 }}
            whileTap={{ scale: 0.96 }}
          >
            <span className="bottom-nav__icon-wrap"><Icon name={item.icon} size={22} /></span>
            <span>{item.label}</span>
          </motion.a>
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
