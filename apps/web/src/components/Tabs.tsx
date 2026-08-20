import type { KeyboardEvent, ReactNode } from "react";

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

  return (
    <div aria-label={ariaLabel} className={`tabs tabs--${variant}`} id={id} role="tablist">
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
}

export function TabPanel({ id, labelledBy, children, className = "" }: TabPanelProps) {
  return (
    <div aria-labelledby={labelledBy} className={`tabs__panel ${className}`.trim()} id={id} role="tabpanel" tabIndex={0}>
      {children}
    </div>
  );
}
