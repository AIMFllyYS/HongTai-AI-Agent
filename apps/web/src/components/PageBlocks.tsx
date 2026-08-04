import type { ReactNode } from "react";

import type { RecentAnalysis, VisualMedia } from "../data/visual-types";
import { Icon, type IconName } from "./Icon";
import { MediaFrame } from "./MediaFrame";
import { StatusBadge } from "./StatusBadge";

export function iconName(value: string): IconName {
  return value as IconName;
}

export interface PageHeadingProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function PageHeading({ eyebrow, title, description, action, className = "" }: PageHeadingProps) {
  return (
    <div className={`page-heading ${className}`.trim()}>
      <div>
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </div>
  );
}

export interface SectionHeadingProps {
  readonly title: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function SectionHeading({ title, action, className = "" }: SectionHeadingProps) {
  return (
    <div className={`section-heading ${className}`.trim()}>
      <h3>{title}</h3>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export interface TabsProps {
  readonly tabs: readonly string[];
  readonly active: string;
  readonly onSelect?: (tab: string) => void;
}

export function Tabs({ tabs, active, onSelect }: TabsProps) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab === active}
          className={tab === active ? "is-active" : ""}
          key={tab}
          onClick={() => onSelect?.(tab)}
          role="tab"
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export interface ChipProps {
  readonly children: ReactNode;
  readonly selected?: boolean;
  readonly icon?: IconName;
  readonly onClick?: () => void;
}

export function Chip({ children, selected = false, icon, onClick }: ChipProps) {
  const content = <>{icon ? <Icon name={icon} size={15} /> : null}{children}</>;
  if (!onClick) return <span className={`chip ${selected ? "is-selected" : ""}`.trim()}>{content}</span>;
  return <button className={`chip ${selected ? "is-selected" : ""}`.trim()} onClick={onClick} type="button">{content}</button>;
}

export interface RecentAnalysisListProps {
  readonly items: readonly RecentAnalysis[];
  readonly navigate: (path: string) => void;
  readonly compact?: boolean;
}

export function RecentAnalysisList({ items, navigate, compact = false }: RecentAnalysisListProps) {
  return (
    <div className={`recent-list ${compact ? "recent-list--compact" : ""}`.trim()}>
      {items.map((item) => (
        <button className="recent-list__item" key={item.id} onClick={() => navigate("/analyze/result")} type="button">
          {item.media ? <MediaFrame className="recent-list__media" media={item.media} /> : null}
          <span className="recent-list__body">
            <strong>{item.title}</strong>
            <span className="recent-list__meta">{item.updatedAt}</span>
            <StatusBadge compact label={item.statusLabel} status={item.status} />
          </span>
          <Icon className="recent-list__chevron" name="chevron_right" size={18} />
        </button>
      ))}
    </div>
  );
}

export interface MetricGridProps {
  readonly items: readonly { readonly icon: string; readonly label: string; readonly value: string }[];
}

export function MetricGrid({ items }: MetricGridProps) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <div className="metric-grid__item" key={item.label}>
          <Icon name={iconName(item.icon)} size={18} />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function MediaLabel({ media, label }: { readonly media: VisualMedia; readonly label: string }) {
  return <MediaFrame media={media}><span className="media-label">{label}</span></MediaFrame>;
}
