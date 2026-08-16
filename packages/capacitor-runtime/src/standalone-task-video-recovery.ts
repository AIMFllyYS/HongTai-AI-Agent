import { issueFromAppError, TaskError } from "@hongtai/core";
import type { AppTaskRecord, MediaReference, TaskChangeEventV1, TaskIssue, TaskRecord } from "@hongtai/core";

import type { NativeTaskFiles } from "./thin-task-files.js";
import type { NativeVideoOperationResult } from "./standalone-bridge.js";
import { toAppTask } from "./standalone-task-detail-projection.js";

const TASK_REQUEST_PATH = "request.json";

export type TaskVideoRecovery =
  | { readonly status: "none" }
  | { readonly status: "succeeded"; readonly task: AppTaskRecord }
  | { readonly status: "failed"; readonly issue: TaskIssue };

export interface StandaloneTaskVideoPicker {
  pickVideo(options: { readonly taskId: string }): Promise<{
    readonly uri: string;
    readonly mimeType: "video/mp4";
    readonly displayName: string;
    readonly sizeBytes: number;
    readonly durationSeconds: number;
  }>;
  consumeVideoOperation(): Promise<NativeVideoOperationResult>;
}

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

function nativeCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Readonly<Record<string, unknown>>).code;
  return typeof code === "string" ? code : undefined;
}

export function videoImportError(error: unknown): TaskError {
  switch (nativeCode(error)) {
    case "ERR_MEDIA_SELECTION_CANCELLED":
      return new TaskError({ code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择本地视频", action: "select_media", cause: error });
    case "ERR_MEDIA_SOURCE_MISSING":
      return new TaskError({ code: "MEDIA_SOURCE_NOT_FOUND", message: "系统没有返回可读取的视频", action: "select_media", cause: error });
    case "ERR_MEDIA_READ_FAILED":
      return new TaskError({ code: "MEDIA_READ_FAILED", message: "所选本地视频无法读取", action: "select_media", cause: error });
    case "ERR_VIDEO_RECOVERY_FAILED":
      return new TaskError({ code: "TASK_INTERRUPTED", message: "视频选择在应用重建后无法恢复，请重新选择", action: "select_media", cause: error });
    default:
      return error instanceof TaskError ? error : new TaskError({ code: "MEDIA_IMPORT_FAILED", message: "本地视频导入没有完成", action: "select_media", cause: error });
  }
}

export async function persistImportedVideo(
  taskId: string,
  selected: {
    readonly uri: string;
    readonly mimeType: "video/mp4";
    readonly displayName: string;
    readonly sizeBytes: number;
    readonly durationSeconds: number;
  },
  options: {
    readonly artifactStore: NativeTaskFiles;
    readonly toDisplayUri: (nativeUri: string) => string;
    readonly now: () => Date;
    readonly emitChange: (event: TaskChangeEventV1) => Promise<void>;
  },
): Promise<AppTaskRecord> {
  if (selected.mimeType !== "video/mp4" || !selected.displayName.trim() || selected.sizeBytes <= 0 || selected.durationSeconds <= 0) {
    throw taskError("MEDIA_IMPORT_FAILED", "本地视频导入没有返回有效 MP4", "select_media");
  }
  const paths = await options.artifactStore.initializeTask(taskId);
  const now = currentIso(options.now);
  const pending: TaskRecord = {
    id: taskId,
    sourceUrl: "",
    sourceKind: "local_video",
    status: "queued",
    contentType: "video",
    analysisStatus: "not_started",
    createdAt: now,
    updatedAt: now,
    issues: [],
    paths,
  };
  await Promise.all([
    options.artifactStore.writeJson(paths.task, pending),
    options.artifactStore.writeJson(`task://${taskId}/${TASK_REQUEST_PATH}`, {
      kind: "local_video",
      displayName: selected.displayName.trim(),
    }),
  ]);
  const media: readonly MediaReference[] = [{
    uri: options.toDisplayUri(selected.uri),
    kind: "video",
    origin: "imported",
    mimeType: "video/mp4",
    byteLength: selected.sizeBytes,
    durationSeconds: selected.durationSeconds,
    displayName: selected.displayName.trim(),
  }];
  const projection = toAppTask(pending, media);
  await options.emitChange({ schemaVersion: "task-change.v1", type: "upsert", task: projection });
  return projection;
}

export async function consumeTaskVideoRecovery(
  fileMedia: StandaloneTaskVideoPicker | undefined,
  persist: (
    taskId: string,
    selected: {
      readonly uri: string;
      readonly mimeType: "video/mp4";
      readonly displayName: string;
      readonly sizeBytes: number;
      readonly durationSeconds: number;
    },
  ) => Promise<AppTaskRecord>,
  deleteTask: (taskId: string) => Promise<void>,
): Promise<TaskVideoRecovery> {
  if (!fileMedia) return { status: "none" };
  let recovered: NativeVideoOperationResult;
  try {
    recovered = await fileMedia.consumeVideoOperation();
  } catch (error) {
    return { status: "failed", issue: issueFromAppError(videoImportError(error)) };
  }
  if (recovered.status === "none") return { status: "none" };
  if (recovered.status === "failed") {
    return { status: "failed", issue: issueFromAppError(videoImportError({ code: recovered.code })) };
  }
  try {
    return { status: "succeeded", task: await persist(recovered.taskId, recovered) };
  } catch (error) {
    await deleteTask(recovered.taskId).catch(() => undefined);
    return { status: "failed", issue: issueFromAppError(videoImportError(error)) };
  }
}
