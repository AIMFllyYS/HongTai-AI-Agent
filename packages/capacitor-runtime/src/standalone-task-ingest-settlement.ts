import { issueFromError, TaskError } from "@hongtai/core";
import type { AppTaskRecord, MediaReference, TaskChangeEventV1, TaskIssue, TaskRecord } from "@hongtai/core";

import type { NativeTaskFiles } from "./thin-task-files.js";
import { toAppTask } from "./standalone-task-detail-projection.js";

function taskError(
  code: ConstructorParameters<typeof TaskError>[0]["code"],
  message: string,
  action: ConstructorParameters<typeof TaskError>[0]["action"] = "none",
): TaskError {
  return new TaskError({ code, message, action });
}

function currentIso(now: () => Date): string {
  return now().toISOString();
}

export async function settleAfterPipeline(
  taskId: string,
  pipelineIssues: readonly TaskIssue[],
  runError: unknown,
  options: {
    readonly readTask: (taskId: string) => Promise<TaskRecord | undefined>;
    readonly taskMedia: (task: TaskRecord) => Promise<readonly MediaReference[]>;
    readonly failQueuedSnapshot: (task: TaskRecord, issues: readonly TaskIssue[]) => Promise<AppTaskRecord>;
  },
): Promise<AppTaskRecord> {
  const persisted = await options.readTask(taskId);
  if (persisted?.status === "queued") {
    const issues = pipelineIssues.length > 0
      ? pipelineIssues
      : [issueFromError(runError ?? taskError("STORAGE_WRITE_FAILED", "产物保存失败", "free_storage"), "save-artifacts")];
    return options.failQueuedSnapshot(persisted, issues);
  }
  if (runError) throw runError;
  if (!persisted) throw taskError("TASK_ARTIFACT_MISSING", "任务完成后未找到本地结果", "view_partial_result");
  return toAppTask(persisted, await options.taskMedia(persisted));
}

export async function failQueuedSnapshot(
  task: TaskRecord,
  issues: readonly TaskIssue[],
  options: {
    readonly now: () => Date;
    readonly artifactStore: NativeTaskFiles;
    readonly taskMedia: (task: TaskRecord) => Promise<readonly MediaReference[]>;
    readonly emitChange: (event: TaskChangeEventV1) => Promise<void>;
  },
): Promise<AppTaskRecord> {
  const path = task.paths?.task;
  if (!path) throw taskError("STORAGE_WRITE_FAILED", "产物保存失败", "free_storage");
  const failed: TaskRecord = {
    ...task,
    status: "failed",
    updatedAt: currentIso(options.now),
    issues: [...task.issues, ...issues],
  };
  await options.artifactStore.writeJson(path, failed);
  const projection = toAppTask(failed, await options.taskMedia(failed));
  await options.emitChange({ schemaVersion: "task-change.v1", type: "upsert", task: projection });
  return projection;
}
