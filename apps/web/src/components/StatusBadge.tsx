import type { VisualStatus } from "../data/visual-types";
import { Icon } from "./Icon";

export interface StatusBadgeProps {
  readonly status: VisualStatus;
  readonly label: string;
  readonly compact?: boolean;
}

export function StatusBadge({ status, label, compact = false }: StatusBadgeProps) {
  const icon = status === "completed" ? "check_circle" : status === "processing" ? "sync" : status === "pending" ? "pending" : status === "failed" ? "error" : "info";
  return <span className={`status-badge status-badge--${status} ${compact ? "status-badge--compact" : ""}`.trim()}><Icon name={icon} size={compact ? 13 : 15} />{label}</span>;
}
