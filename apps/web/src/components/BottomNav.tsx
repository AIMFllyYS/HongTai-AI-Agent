import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
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
  const [materialsOpen, setMaterialsOpen] = useState(false);

  useEffect(() => {
    if (!materialsOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaterialsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [materialsOpen]);

  const content = (
    <>
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
        <motion.button
          aria-haspopup="dialog"
          className="bottom-nav__item bottom-nav__item--materials"
          onClick={() => setMaterialsOpen(true)}
          transition={{ duration: 0.14 }}
          type="button"
          whileTap={{ scale: 0.96 }}
        >
          <span className="bottom-nav__icon-wrap"><Icon name="video_library" size={22} /></span>
          <span>富迪素材库</span>
        </motion.button>
      </nav>
      {materialsOpen ? (
        <div
          aria-label="关闭富迪素材库"
          className="material-library-dialog__backdrop"
          onClick={() => setMaterialsOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="material-library-title"
            aria-modal="true"
            className="material-library-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="material-library-dialog__header">
              <strong id="material-library-title">富迪素材库</strong>
              <button aria-label="关闭富迪素材库" onClick={() => setMaterialsOpen(false)} type="button">
                <Icon name="close" size={20} />
              </button>
            </header>
            <img
              alt="富迪素材库宣传图"
              className="material-library-dialog__image"
              src="/materials/fudi-material-library.jpg"
            />
          </section>
        </div>
      ) : null}
    </>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

export function activeNavForRoute(route: RouteKey): BottomNavProps["active"] {
  if (route === "vitality-scan" || route === "vitality-result" || route === "observation-new" || route === "observation-report") return "ai";
  if (route === "create") return "create";
  if (route === "templates") return "templates";
  if (route === "settings" || route === "settings-profile" || route === "settings-ai") return "settings";
  if (route === "home" || route === "task-processing" || route === "task-detail" || route === "task-analysis" || route === "processing" || route === "analysis-result" || route === "video-detail" || route === "gallery-detail") return "home";
  return undefined;
}
