import type { AppTaskRecord, TaskChangeEventV1, TaskDetailRecord, TaskEventRecord, TaskIssue, TaskStatus } from "@hongtai/core";

import { preferNewerByUpdatedAt } from "../features/tasks/latest-read-guard";
import { matchRoute, pathForRoute, taskAnalysisPath, taskDetailPath, type Navigate } from "../router";

export type TaskResultTab = "source" | "analysis";
export type TaskCompletedPrimaryAction = "none" | "start-analysis" | "next-steps";

export const ANALYSIS_TAB_LABEL = "AI自动拆解";

export function sourceTabLabel(contentType?: string): string {
  return contentType === "image_text" ? "图文正文" : "原始文稿";
}

export function taskResultTabs(contentType?: string): readonly string[] {
  return [sourceTabLabel(contentType), ANALYSIS_TAB_LABEL];
}

export function taskResultTabFromPath(pathname: string): TaskResultTab {
  return matchRoute(pathname).key === "task-analysis" ? "analysis" : "source";
}

export function pathForTaskResultTab(taskId: string, tab: TaskResultTab): string {
  return tab === "analysis" ? taskAnalysisPath(taskId) : taskDetailPath(taskId);
}

export function syncTaskResultTabPath(taskId: string, tab: TaskResultTab): void {
  if (typeof window === "undefined") return;
  const next = pathForTaskResultTab(taskId, tab);
  if (window.location.pathname === next) return;
  window.history.replaceState(window.history.state ?? {}, "", next);
}

export function createPagePathWithSource(taskId: string): string {
  return `/create?sourceId=${encodeURIComponent(taskId)}`;
}

export function sourceIdFromSearch(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    return new URLSearchParams(raw).get("sourceId")?.trim() ?? "";
  } catch {
    return "";
  }
}

function searchWithoutSourceId(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    const params = new URLSearchParams(raw);
    params.delete("sourceId");
    const next = params.toString();
    return next ? `?${next}` : "";
  } catch {
    return "";
  }
}

export function consumeCreateSourceIdFromSearch(): string {
  if (typeof window === "undefined") return "";
  const requested = sourceIdFromSearch(window.location.search);
  if (!requested) return "";
  const nextSearch = searchWithoutSourceId(window.location.search);
  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash ?? ""}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash ?? ""}` !== nextUrl) {
    window.history.replaceState(window.history.state ?? {}, "", nextUrl);
  }
  return requested;
}

export function navigateToCreateWithSource(navigate: Navigate, taskId: string): void {
  navigate(pathForRoute("create"));
  if (typeof window === "undefined") return;
  const next = createPagePathWithSource(taskId);
  if (`${window.location.pathname}${window.location.search}` === next) return;
  window.history.replaceState(window.history.state ?? {}, "", next);
}

export function showProcessingLeaveHint(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

export function isEligibleCreateSourceTask(status: TaskStatus): boolean {
  return status === "succeeded" || status === "degraded";
}

export function resolveCreateWorkbenchEntry(input: {
  readonly requestedSourceId: string;
  readonly availableSourceIds: readonly string[];
  readonly currentSourceId?: string;
  readonly composingNew?: boolean;
}): {
  readonly composingNew: boolean;
  readonly sourceId: string;
  readonly sourceMatchFailed: boolean;
} {
  if (input.requestedSourceId) {
    const matched = input.availableSourceIds.includes(input.requestedSourceId);
    return {
      composingNew: true,
      sourceId: matched ? input.requestedSourceId : "",
      sourceMatchFailed: !matched,
    };
  }
  const current = input.currentSourceId ?? "";
  if (input.composingNew && !current) {
    return { composingNew: true, sourceId: "", sourceMatchFailed: false };
  }
  return {
    composingNew: Boolean(input.composingNew),
    sourceId: input.availableSourceIds.includes(current) ? current : (input.availableSourceIds[0] ?? ""),
    sourceMatchFailed: false,
  };
}

export type TaskCompletedBarAction = TaskCompletedPrimaryAction | "confirm-analysis";

export function resolveCompletedBarAction(input: {
  readonly primary: TaskCompletedPrimaryAction;
  readonly confirmationOpen: boolean;
  readonly deleteConfirmationOpen: boolean;
}): TaskCompletedBarAction {
  if (input.deleteConfirmationOpen) return "none";
  if (input.confirmationOpen) return "confirm-analysis";
  return input.primary;
}

export function resolveCompletedPrimaryAction(input: {
  readonly analysisStatus?: string;
  readonly analysisAvailable: boolean;
  readonly hasEvidence: boolean;
}): TaskCompletedPrimaryAction {
  if (!input.analysisAvailable || input.analysisStatus === "running") return "none";
  if (input.analysisStatus === "succeeded") return "next-steps";
  if (!input.hasEvidence) return "none";
  if (input.analysisStatus === "not_started" || input.analysisStatus === "failed") return "start-analysis";
  return "none";
}

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
