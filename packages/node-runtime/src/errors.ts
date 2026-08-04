import { TaskError } from "@hongtai/core";

interface NodeErrorLike {
  readonly code?: string;
  readonly name?: string;
}

export function storageTaskError(error: unknown, message = "产物保存失败"): TaskError {
  const value = error as NodeErrorLike;
  if (value?.code === "ENOSPC") {
    return new TaskError({ code: "STORAGE_SPACE_INSUFFICIENT", message: "设备存储空间不足", action: "free_storage", cause: error });
  }
  if (value?.code === "EACCES" || value?.code === "EPERM") {
    return new TaskError({ code: "STORAGE_PERMISSION_DENIED", message: "没有文件保存权限", action: "free_storage", cause: error });
  }
  return new TaskError({ code: "STORAGE_WRITE_FAILED", message, action: "free_storage", cause: error });
}

export function mediaNetworkError(error: unknown): TaskError {
  const value = error as NodeErrorLike;
  const timedOut = value?.name === "AbortError" || value?.name === "TimeoutError";
  return new TaskError({
    code: timedOut ? "MEDIA_DOWNLOAD_TIMEOUT" : "MEDIA_DOWNLOAD_FAILED",
    message: timedOut ? "媒体下载超时" : "媒体下载连接失败",
    retryable: true,
    action: "retry",
    cause: error,
  });
}
