import type {
  ErrorCode,
  IssueAction,
  NativeLinkDiagnosticV1,
  SupportedPlatform,
  TaskIssue,
  TaskStage,
} from "./models";

interface TaskErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly action?: IssueAction;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly diagnostic?: NativeLinkDiagnosticV1;
  readonly cause?: unknown;
}

export class TaskError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly action: IssueAction;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly diagnostic?: NativeLinkDiagnosticV1;

  constructor(options: TaskErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "TaskError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.action = options.action ?? "none";
    this.details = options.details;
    this.diagnostic = options.diagnostic;
  }
}

const NATIVE_ERROR_CODE = /^ERR_[A-Z0-9_]{2,116}$/;

function nativeCodeFrom(error: unknown, remainingDepth = 3): string | undefined {
  if (remainingDepth <= 0 || typeof error !== "object" || error === null) return undefined;
  const value = error as Readonly<Record<string, unknown>>;
  if (typeof value.code === "string" && NATIVE_ERROR_CODE.test(value.code)) return value.code;
  return nativeCodeFrom(value.cause, remainingDepth - 1);
}

function safeDetails(
  error: unknown,
  existing?: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> | undefined {
  const nativeCode = nativeCodeFrom(error);
  const cause = error instanceof Error ? error.name : undefined;
  if (!existing && !nativeCode && !cause) return undefined;
  return {
    ...existing,
    ...(cause && !existing ? { cause } : {}),
    ...(nativeCode ? { nativeCode } : {}),
  };
}

const FALLBACK_BY_STAGE: Readonly<Record<TaskStage, Pick<TaskErrorOptions, "code" | "message" | "action">>> = {
  "detect-platform": { code: "INPUT_URL_INVALID", message: "无法识别输入中的视频或笔记链接", action: "edit_input" },
  "resolve-link": { code: "LINK_NETWORK_FAILED", message: "链接解析失败，请检查网络后重试", action: "check_network" },
  "parse-content": { code: "CONTENT_PARSE_FAILED", message: "没有成功解析作品内容", action: "retry" },
  "select-media": { code: "MEDIA_SOURCE_NOT_FOUND", message: "作品中没有找到可用媒体资源", action: "view_partial_result" },
  "download-media": { code: "MEDIA_DOWNLOAD_FAILED", message: "媒体下载失败", action: "retry" },
  "obtain-transcript": { code: "AI_NETWORK_FAILED", message: "文稿生成失败", action: "retry" },
  "save-artifacts": { code: "STORAGE_WRITE_FAILED", message: "产物保存失败", action: "free_storage" },
};

export function issueFromError(
  error: unknown,
  stage: TaskStage,
  platform?: SupportedPlatform,
): TaskIssue {
  if (error instanceof TaskError) {
    return {
      code: error.code,
      severity: "error",
      stage,
      userMessage: error.message,
      retryable: error.retryable,
      action: error.action,
      platform,
      details: safeDetails(error.cause, error.details),
      diagnostic: error.diagnostic,
    };
  }
  const fallback = FALLBACK_BY_STAGE[stage];
  return {
    code: fallback.code,
    severity: "error",
    stage,
    userMessage: fallback.message,
    retryable: false,
    action: fallback.action ?? "none",
    platform,
    details: safeDetails(error),
  };
}

/**
 * Maps profile, secure-storage, media-selection and other application-service
 * failures without inventing an ingest stage. The UI may use this for its one
 * issue presenter while preserving the stricter seven-stage mapper above.
 */
export function issueFromAppError(
  error: unknown,
  fallback: Pick<TaskErrorOptions, "code" | "message" | "action"> = {
    code: "INTERNAL_UNKNOWN_ERROR",
    message: "本地应用操作失败",
    action: "none",
  },
): TaskIssue {
  if (error instanceof TaskError) {
    return {
      code: error.code,
      severity: "error",
      userMessage: error.message,
      retryable: error.retryable,
      action: error.action,
      details: safeDetails(error.cause, error.details),
      diagnostic: error.diagnostic,
    };
  }
  return {
    code: fallback.code,
    severity: "error",
    userMessage: fallback.message,
    retryable: false,
    action: fallback.action ?? "none",
    details: safeDetails(error),
  };
}

export function warningIssue(
  code: ErrorCode,
  stage: TaskStage,
  userMessage: string,
  options: {
    readonly action?: IssueAction;
    readonly retryable?: boolean;
    readonly platform?: SupportedPlatform;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
  } = {},
): TaskIssue {
  return {
    code,
    severity: "warning",
    stage,
    userMessage,
    retryable: options.retryable ?? false,
    action: options.action ?? "none",
    platform: options.platform,
    details: options.details,
  };
}

export function safeUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "无效URL";
  }
}
