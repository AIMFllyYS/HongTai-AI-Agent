import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Icon } from "./Icon";
import { type Navigate, type RouteKey } from "../router";
import { primaryNavItems } from "../navigation/primary-nav";

export type BottomNavVisualTheme = "workbench" | "warm-soft-tech";

export interface BottomNavProps {
  readonly active?: "ai" | "home" | "create" | "templates" | "settings";
  readonly navigate: Navigate;
  readonly visualTheme?: BottomNavVisualTheme;
}

export function BottomNav({ active, navigate, visualTheme = "workbench" }: BottomNavProps) {
  const content = (
    <nav aria-label="主导航" className="bottom-nav" data-visual-theme={visualTheme}>
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
              navigate(item.path, { scroll: "auto", transition: "instant" });
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

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

export function activeNavForRoute(route: RouteKey): BottomNavProps["active"] {
  if (route === "observation-new" || route === "observation-report") return "ai";
  if (route === "create" || route === "production-edit") return "create";
  if (route === "templates") return "templates";
  if (route === "settings" || route === "settings-profile" || route === "settings-ai" || route === "settings-app-info") return "settings";
  if (route === "home" || route === "task-processing" || route === "task-detail" || route === "task-analysis") return "home";
  return undefined;
}
