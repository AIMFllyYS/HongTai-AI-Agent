import type { ReactNode } from "react";

import type { RecentAnalysis } from "../data/visual-types";
import { Icon, type IconName } from "./Icon";
import { MediaFrame } from "./MediaFrame";
import { StatusBadge } from "./StatusBadge";

export function iconName(value: string): IconName {
  return value as IconName;
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
