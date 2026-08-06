import type { TaskStatus } from "@hongtai/core";

import { Icon } from "./Icon";
import { taskStatusLabel, taskStatusTone } from "../features/tasks/task-presenters";

export interface TaskStatusBadgeProps {
  readonly status: TaskStatus;
  readonly compact?: boolean;
}

export function TaskStatusBadge({ status, compact = false }: TaskStatusBadgeProps) {
  const tone = taskStatusTone(status);
  const icon = tone === "completed" ? "check_circle" : tone === "processing" ? "sync" : tone === "pending" ? "pending" : tone === "failed" ? "error" : "info";
  return (
    <span className={`status-badge status-badge--${tone} ${compact ? "status-badge--compact" : ""}`.trim()} data-task-status={status}>
      <Icon name={icon} size={compact ? 13 : 15} />{taskStatusLabel(status)}
    </span>
  );
}
