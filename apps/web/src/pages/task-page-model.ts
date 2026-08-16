import type { AppTaskRecord, TaskChangeEventV1, TaskDetailRecord, TaskEventRecord, TaskIssue, TaskStatus } from "@hongtai/core";

import { preferNewerByUpdatedAt } from "../features/tasks/latest-read-guard";

export type TaskPageSurface = "loading" | "missing-task" | "processing" | "completed-missing" | "completed";

export function isCompletedTaskSurface(status: TaskStatus): boolean {
  return status === "succeeded" || status === "degraded";
}

export function resolveTaskPageSurface(input: {
  readonly loading: boolean;
  readonly status?: TaskStatus;
  readonly hasDetail: boolean;
}): TaskPageSurface {
  if (input.loading) return "loading";
  if (input.status === undefined) return "missing-task";
  if (!isCompletedTaskSurface(input.status)) return "processing";
  if (!input.hasDetail) return "completed-missing";
  return "completed";
}

export function mergeEvents(existing: readonly TaskEventRecord[], incoming: TaskEventRecord): readonly TaskEventRecord[] {
  const bySequence = new Map(existing.map((event) => [event.sequence, event]));
  bySequence.set(incoming.sequence, incoming);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function newestIssue(task: AppTaskRecord | undefined, events: readonly TaskEventRecord[], localIssue: TaskIssue | undefined): TaskIssue | undefined {
  if (localIssue) return localIssue;
  const eventIssue = events.slice().sort((left, right) => right.sequence - left.sequence).find((event) => event.issue)?.issue;
  const taskIssues = task?.issues;
  return eventIssue ?? (taskIssues && taskIssues.length > 0 ? taskIssues[taskIssues.length - 1] : undefined);
}

export function applyTaskDetailChange(
  current: TaskDetailRecord | undefined,
  event: TaskChangeEventV1,
  taskId: string,
): TaskDetailRecord | undefined {
  if (event.type === "deleted") return event.taskId === taskId ? undefined : current;
  if (event.task.id !== taskId || !current) return current;
  const task = preferNewerByUpdatedAt(current.task, event.task) ?? current.task;
  return task === current.task ? current : { ...current, task };
}
