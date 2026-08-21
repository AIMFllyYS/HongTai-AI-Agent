import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Icon } from "./Icon";
import { ComposeSheet } from "./ComposeSheet";
import { type Navigate, type RouteKey } from "../router";
import { primaryNavItems } from "../navigation/primary-nav";

export interface BottomNavProps {
  readonly active?: "ai" | "home" | "create" | "templates" | "settings";
  readonly navigate: Navigate;
}

export function BottomNav({ active, navigate }: BottomNavProps) {
  const [composeOpen, setComposeOpen] = useState(false);
  const plusActive = active === "create";

  const content = (
    <>
      <nav aria-label="主导航" className="bottom-nav">
        {primaryNavItems.slice(0, 2).map((item) => {
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
        <div className="bottom-nav__item bottom-nav__item--compose">
          <button
            aria-expanded={composeOpen}
            aria-haspopup="dialog"
            aria-label="新建"
            className={`bottom-nav__plus ${plusActive ? "is-active" : ""}`.trim()}
            onClick={() => setComposeOpen(true)}
            type="button"
          >
            <Icon name="plus" size={22} />
          </button>
        </div>
        {primaryNavItems.slice(2).map((item) => {
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
      <ComposeSheet navigate={navigate} onClose={() => setComposeOpen(false)} open={composeOpen} />
    </>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

export function activeNavForRoute(route: RouteKey): BottomNavProps["active"] {
  if (route === "observation-new" || route === "observation-report") return "ai";
  if (route === "create" || route === "production-edit" || route === "replica-wizard") return "create";
  if (route === "templates") return "templates";
  if (route === "settings" || route === "settings-profile" || route === "settings-ai" || route === "settings-app-info" || route === "playbook") return "settings";
  if (route === "home" || route === "task-processing" || route === "task-detail" || route === "task-analysis") return "home";
  return undefined;
}
