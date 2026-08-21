import { TaskError } from "@hongtai/core";
import type { TaskIssue } from "@hongtai/core";

export function productionArtifactError(message: string, action: "retry" | "select_media" = "retry"): TaskError {
  return new TaskError({ code: "TASK_ARTIFACT_MISSING", message, action });
}

function nativeCode(error: unknown, remainingDepth = 3): string | undefined {
  if (remainingDepth <= 0 || typeof error !== "object" || error === null) return undefined;
  const value = error as Readonly<Record<string, unknown>>;
  if (typeof value.code === "string" && /^ERR_[A-Z0-9_]{2,116}$/u.test(value.code)) return value.code;
  return nativeCode(value.cause, remainingDepth - 1);
}

/** Keeps a private-file failure branchable by code instead of leaking a raw platform rejection. */
export function storageTaskError(error: unknown, message: string): TaskError {
  return error instanceof TaskError ? error : new TaskError({ code: "STORAGE_WRITE_FAILED", message, action: "retry", cause: error });
}

export function productionTaskError(error: unknown, fallbackMessage: string): TaskError {
  if (error instanceof TaskError) return error;
  const code = nativeCode(error);
  const mapped: Readonly<Record<string, Readonly<{
    code: TaskIssue["code"];
    message: string;
    action: "retry" | "select_media" | "free_storage" | "edit_input" | "none";
    retryable: boolean;
  }>>> = {
    // The renderer rejected the plan itself. Retrying the same plan can only fail again, so this
    // must not be dressed up as a transient render failure.
    ERR_INVALID_ARGUMENT: { code: "PRODUCTION_PLAN_EDIT_INVALID", message: "当前制作计划无法被本地渲染器执行，请调整镜头时长或文案后重新生成计划。", action: "edit_input", retryable: false },
    ERR_DECORATION_ASSET_MISSING: { code: "PRODUCTION_DECORATION_MISSING", message: "这台安装缺少成片要用的贴纸文件，改镜头或文案解决不了。请重新安装完整应用后再导出。", action: "none", retryable: false },
    ERR_MEDIA_SELECTION_CANCELLED: { code: "MEDIA_SELECTION_CANCELLED", message: "已取消选择制作素材。", action: "select_media", retryable: false },
    ERR_MEDIA_SOURCE_MISSING: { code: "MEDIA_SOURCE_NOT_FOUND", message: "系统没有返回可读取的制作素材。", action: "select_media", retryable: false },
    ERR_MEDIA_READ_FAILED: { code: "MEDIA_READ_FAILED", message: "所选制作素材无法读取，请重新选择。", action: "select_media", retryable: false },
    ERR_ASSET_RECOVERY_FAILED: { code: "TASK_INTERRUPTED", message: "素材选择在应用重建后无法恢复，请重新选择。", action: "select_media", retryable: false },
    ERR_MEDIA_SOURCE_INVALID: { code: "MEDIA_SOURCE_INVALID", message: "素材不含可用于本地合成的媒体轨，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_MEDIA_PROBE_FAILED: { code: "MEDIA_PROBE_FAILED", message: "无法读取素材的媒体轨或时长，请重新选择完整文件。", action: "select_media", retryable: false },
    ERR_PRIVATE_FILE_IMPORT_FAILED: { code: "MEDIA_IMPORT_FAILED", message: "素材无法安全导入应用私有目录，请重新选择。", action: "select_media", retryable: false },
    ERR_TTS_UNAVAILABLE: { code: "TTS_UNAVAILABLE", message: "视频配音暂不可用。请检查 AI 连接中的 TTS 配置；未配置云端配音时，请确认手机已启用中文系统语音。", action: "retry", retryable: true },
    ERR_TTS_SYNTHESIS_FAILED: { code: "TTS_SYNTHESIS_FAILED", message: "视频旁白没有生成成功。请检查 AI 连接、网络或手机语音服务后重试。", action: "retry", retryable: true },
    ERR_MEDIA_RENDER_TIMEOUT: { code: "MEDIA_RENDER_TIMEOUT", message: "本地合成超时，已保留之前成功的成片。请减少时长或更换较小的素材后重试。", action: "retry", retryable: true },
    ERR_MEDIA_ENCODER_UNAVAILABLE: { code: "MEDIA_ENCODER_UNAVAILABLE", message: "这台手机未能用 H.264 编码器完成本次导出。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_MEDIA_DECODE_FAILED: { code: "MEDIA_DECODE_FAILED", message: "当前素材无法解码或缺少可用音轨，请重新选择可播放的素材。", action: "select_media", retryable: false },
    ERR_MEDIA_RENDER_PIPELINE_FAILED: { code: "MEDIA_RENDER_PIPELINE_FAILED", message: "本地画面处理没有完成。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_MEDIA_OUTPUT_INVALID: { code: "MEDIA_OUTPUT_INVALID", message: "导出文件未通过 H.264/AAC 成片校验，未覆盖之前成功的成片。请重试。", action: "retry", retryable: true },
    ERR_MEDIA_EXPORT_FAILED: { code: "MEDIA_EXPORT_FAILED", message: "本地视频导出没有完成。已保留之前成功的成片，请稍后重试。", action: "retry", retryable: true },
    ERR_OUTPUT_FINALIZATION_FAILED: { code: "OUTPUT_FINALIZATION_FAILED", message: "新成片无法安全写入本地目录，之前成功的成片已保留。", action: "free_storage", retryable: true },
  };
  const selected = code ? mapped[code] : undefined;
  return new TaskError({
    code: selected?.code ?? "MEDIA_MERGE_FAILED",
    message: selected?.message ?? fallbackMessage,
    action: selected?.action ?? "retry",
    retryable: selected?.retryable ?? true,
    cause: error,
  });
}
