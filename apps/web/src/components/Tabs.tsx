import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { motionDurations, motionEasing, tabOffset, type RouteTransitionDirection } from "../motion/tokens";

export interface TabsProps {
  readonly tabs: readonly string[];
  readonly active: string;
  readonly onSelect?: (tab: string) => void;
  readonly id?: string;
  readonly panelId?: string;
  readonly ariaLabel?: string;
  readonly variant?: "underline" | "segmented";
}

export function tabId(groupId: string, index: number): string {
  return `${groupId}-tab-${index}`;
}

export function tabPanelId(groupId: string): string {
  return `${groupId}-panel`;
}

export function Tabs({ tabs, active, onSelect, id = "tabs", panelId = tabPanelId(id), ariaLabel = "内容切换", variant = "underline" }: TabsProps) {
  const activeIndex = Math.max(0, tabs.indexOf(active));

  const moveFocus = (index: number) => {
    document.getElementById(tabId(id, index))?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length < 2) return;

    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === index) return;

    event.preventDefault();
    moveFocus(nextIndex);
    const nextTab = tabs[nextIndex];
    if (nextTab) onSelect?.(nextTab);
  };

  const segmentedStyle = variant === "segmented"
    ? { "--tab-count": tabs.length, "--tab-index": activeIndex } as CSSProperties
    : undefined;

  return (
    <div aria-label={ariaLabel} className={`tabs tabs--${variant}`} id={id} role="tablist" style={segmentedStyle}>
      {variant === "segmented" ? <span aria-hidden="true" className="tabs--segmented__thumb" /> : null}
      {tabs.map((tab, index) => {
        const selected = index === activeIndex;
        return (
          <button
            aria-controls={panelId}
            aria-selected={selected}
            className={selected ? "is-active" : ""}
            id={tabId(id, index)}
            key={tab}
            onClick={() => onSelect?.(tab)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  readonly id: string;
  readonly labelledBy: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly slideKey?: string;
  readonly tabs?: readonly string[];
}

export function TabPanel({ id, labelledBy, children, className = "", slideKey, tabs }: TabPanelProps) {
  const previousKey = useRef(slideKey);
  const from = tabs && previousKey.current ? tabs.indexOf(previousKey.current) : 0;
  const to = tabs && slideKey ? tabs.indexOf(slideKey) : 0;
  const direction: RouteTransitionDirection = to < from ? "backward" : "forward";

  useEffect(() => {
    previousKey.current = slideKey;
  }, [slideKey]);

  if (!slideKey) {
    return (
      <div aria-labelledby={labelledBy} className={`tabs__panel ${className}`.trim()} id={id} role="tabpanel" tabIndex={0}>
        {children}
      </div>
    );
  }

  const offset = tabOffset;
  return (
    <div aria-labelledby={labelledBy} className={`tabs__panel tabs__panel--slide ${className}`.trim()} id={id} role="tabpanel" tabIndex={0}>
      <MotionConfig reducedMotion="user">
        <AnimatePresence custom={direction} initial={false} mode="popLayout">
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            custom={direction}
            exit={{ opacity: 0, x: direction === "forward" ? -offset : offset }}
            initial={{ opacity: 0, x: direction === "forward" ? offset : -offset }}
            key={slideKey}
            transition={{ duration: motionDurations.standard / 1000, ease: motionEasing.emphasized }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    </div>
  );
}
