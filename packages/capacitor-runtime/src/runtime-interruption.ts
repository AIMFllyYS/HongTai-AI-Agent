import type { RuntimeUnfinishedWork, RuntimeWorkKind, TaskIssue } from "@hongtai/core";

export function runtimeInterruptedIssue(): TaskIssue {
  return {
    code: "TASK_INTERRUPTED",
    severity: "warning",
    userMessage: "应用进入后台后本次执行未能可靠继续，已保留现有结果，请重新发起。",
    retryable: false,
    action: "retry",
  };
}

export function persistedRuntimeWork(kind: RuntimeWorkKind, id: string): RuntimeUnfinishedWork {
  return { kind, id, source: "persisted", execution: "in-process" };
}
