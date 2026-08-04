import type {
  ErrorCode,
  IssueAction,
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
  readonly cause?: unknown;
}

export class TaskError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly action: IssueAction;
  readonly details?: Readonly<Record<string, string | number | boolean>>;

  constructor(options: TaskErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "TaskError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.action = options.action ?? "none";
    this.details = options.details;
  }
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
      details: error.details,
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
    details: error instanceof Error ? { cause: error.name } : undefined,
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
