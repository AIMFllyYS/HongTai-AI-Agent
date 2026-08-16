import { useEffect, useRef } from "react";
import type {
  NativeLinkDiagnosticErrorClass,
  NativeLinkDiagnosticPhase,
  NativeNetworkType,
  TaskIssue,
  TaskStage,
} from "@hongtai/core";

import { useNotification } from "../notifications/NotificationProvider";

/**
 * Page controllers supply only actions they can perform against real local
 * state.  The issue presenter never derives an action from an error code and
 * never invents a result when a page cannot safely offer one.
 */
export interface TaskIssueActionHandlers {
  readonly retry?: () => void;
  readonly configureAi?: () => void;
  readonly selectMedia?: () => void;
  readonly partialResult?: () => void;
  readonly editInput?: () => void;
}

type HandledIssueAction = keyof TaskIssueActionHandlers;

interface IssueActionDescriptor {
  readonly label?: string;
  readonly guidance: string;
  readonly handler?: HandledIssueAction;
}

const actionDescriptors: Readonly<Record<TaskIssue["action"], IssueActionDescriptor>> = {
  edit_input: {
    guidance: "请检查刚才填写的内容，再重新提交。",
    handler: "editInput",
  },
  retry: {
    label: "重试",
    guidance: "可以再试一次；已保存的内容不会丢失。",
    handler: "retry",
  },
  wait_and_retry: {
    guidance: "请求有些频繁，请稍后再试。",
  },
  check_network: {
    guidance: "请确认手机可以正常上网，然后再试一次。",
  },
  configure_ai: {
    label: "前往 AI 设置",
    guidance: "请到 AI 连接中检查密钥和所需能力是否可用。",
    handler: "configureAi",
  },
  free_storage: {
    guidance: "手机存储空间可能不足，请释放一些空间后再试。",
  },
  select_media: {
    label: "重新选择",
    guidance: "请重新选择一个可正常播放的文件。",
    handler: "selectMedia",
  },
  view_partial_result: {
    label: "查看部分结果",
    guidance: "已经保存的内容仍可查看。",
    handler: "partialResult",
  },
  none: {
    guidance: "如果问题持续出现，请返回上一页后再试。",
  },
};

export interface IssueNoticeActionPresentation {
  readonly label?: string;
  readonly guidance: string;
  readonly available: boolean;
  readonly onAction?: () => void;
}

/** Maps a stable action value to a page-owned callback without inspecting the error code. */
export function issueActionPresentation(
  action: TaskIssue["action"],
  handlers: TaskIssueActionHandlers = {},
): IssueNoticeActionPresentation {
  const descriptor = actionDescriptors[action];
  const onAction = descriptor.handler ? handlers[descriptor.handler] : undefined;
  return {
    label: onAction ? descriptor.label : undefined,
    guidance: descriptor.guidance,
    available: Boolean(onAction),
    onAction,
  };
}

export interface IssueNoticeProps {
  readonly issue: TaskIssue;
  readonly actions?: TaskIssueActionHandlers;
}

export function isInlineIssueAction(action: TaskIssue["action"]): boolean {
  return action === "edit_input";
}

export function defaultEditInputFocus(): void {
  if (typeof document === "undefined") return;
  document.getElementById("task-share-input")?.focus();
}

const NATIVE_ERROR_CODE = /^ERR_[A-Z0-9_]{2,116}$/;
const SAFE_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const taskStageLabels: Readonly<Record<TaskStage, string>> = {
  "detect-platform": "识别平台",
  "resolve-link": "解析链接",
  "parse-content": "解析内容",
  "select-media": "选择媒体",
  "download-media": "下载媒体",
  "obtain-transcript": "获取文稿",
  "save-artifacts": "保存产物",
};
const phaseLabels: Readonly<Record<NativeLinkDiagnosticPhase, string>> = {
  request: "准备请求",
  connect: "建立连接",
  redirect: "处理跳转",
  response: "读取响应",
  decode: "解码响应",
};
const errorClassLabels: Readonly<Record<NativeLinkDiagnosticErrorClass, string>> = {
  dns: "DNS",
  tls: "TLS",
  connection: "连接失败",
  timeout: "超时",
  redirect_limit: "跳转超限",
  redirect_invalid: "跳转无效",
  response_too_large: "响应过大",
  response_invalid_encoding: "响应编码无效",
  response_io: "响应读取失败",
  invalid_request: "请求无效",
};
const networkTypeLabels: Readonly<Record<NativeNetworkType, string>> = {
  wifi: "Wi-Fi",
  cellular: "蜂窝网络",
  ethernet: "以太网",
  vpn: "VPN",
  offline: "离线",
  other: "其他网络",
  unknown: "未知网络",
};

function integerIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Formats only the versioned diagnostic allowlist; arbitrary native fields are never interpolated. */
export function issueDiagnosticSummary(issue: Pick<TaskIssue, "stage" | "diagnostic">): string | undefined {
  const source = issue.diagnostic as Readonly<Record<string, unknown>> | undefined;
  if (!source || source.schemaVersion !== "native-link-diagnostic.v1" || source.operation !== "fetch-text") return undefined;
  const phase = typeof source.phase === "string" ? phaseLabels[source.phase as NativeLinkDiagnosticPhase] : undefined;
  const errorClass = typeof source.errorClass === "string"
    ? errorClassLabels[source.errorClass as NativeLinkDiagnosticErrorClass]
    : undefined;
  const elapsedMs = integerIn(source.elapsedMs, 0, 600_000);
  const attempt = integerIn(source.attempt, 1, 3);
  const redirectCount = integerIn(source.redirectCount, 0, 5);
  if (!phase || !errorClass || elapsedMs === undefined || attempt === undefined || redirectCount === undefined) return undefined;

  const hostname = typeof source.hostname === "string"
    && SAFE_HOSTNAME.test(source.hostname)
    && !IPV4_LITERAL.test(source.hostname)
    ? source.hostname
    : undefined;
  const networkType = typeof source.networkType === "string"
    ? networkTypeLabels[source.networkType as NativeNetworkType]
    : undefined;
  return [
    "操作：抓取页面",
    ...(issue.stage ? [`任务阶段：${taskStageLabels[issue.stage]}`] : []),
    `原生阶段：${phase}`,
    ...(hostname ? [`主机：${hostname}`] : []),
    `错误：${errorClass}`,
    `耗时：${elapsedMs}ms`,
    ...(networkType ? [`网络：${networkType}`] : []),
    `尝试：${attempt}`,
    `跳转：${redirectCount}`,
  ].join(" · ");
}

export function issueTechnicalCode(issue: Pick<TaskIssue, "code" | "details">): string {
  const nativeCode = issue.details?.nativeCode;
  return typeof nativeCode === "string" && NATIVE_ERROR_CODE.test(nativeCode)
    ? `${issue.code} · ${nativeCode}`
    : issue.code;
}

const issueTitles: Partial<Readonly<Record<TaskIssue["code"], string>>> = {
  AI_NOT_CONFIGURED: "还没有连接 AI 服务",
  AI_SETTINGS_INVALID: "AI 连接设置需要检查",
  AI_AUTH_INVALID: "AI 密钥无法使用",
  AI_PERMISSION_DENIED: "当前账号没有所需能力",
  AI_QUOTA_EXHAUSTED: "AI 账户额度不足",
  AI_RATE_LIMITED: "请求太频繁了",
  AI_NETWORK_FAILED: "暂时无法连接 AI 服务",
  AI_TIMEOUT: "AI 服务响应超时",
  AI_EMPTY_RESPONSE: "没有获得可用内容",
  ASR_PARTIAL_FAILURE: "部分语音没有识别成功",
  MEDIA_SELECTION_CANCELLED: "已取消选择",
  MEDIA_SOURCE_NOT_FOUND: "没有找到可用的媒体",
  MEDIA_IMPORT_FAILED: "视频导入没有完成",
  MEDIA_READ_FAILED: "无法读取这个文件",
  MEDIA_PROBE_FAILED: "无法处理这个视频",
  MEDIA_ENCODER_UNAVAILABLE: "编码器无法完成导出",
  MEDIA_DECODE_FAILED: "素材无法用于合成",
  MEDIA_RENDER_PIPELINE_FAILED: "画面处理没有完成",
  MEDIA_OUTPUT_INVALID: "成片校验没有通过",
  MEDIA_EXPORT_FAILED: "本地导出没有完成",
  TASK_ARTIFACT_MISSING: "所需内容不完整",
  TASK_INTERRUPTED: "上次处理已中断",
  STORAGE_WRITE_FAILED: "内容保存失败",
  APP_RUNTIME_UNAVAILABLE: "应用暂时无法完成操作",
};

export function issueTitle(issue: Pick<TaskIssue, "code" | "userMessage">): string {
  return issueTitles[issue.code] ?? issue.userMessage;
}

/** Shared presentation mapping for stable application issue codes/actions. */
export function IssueNotice({ issue, actions }: IssueNoticeProps) {
  const { show, dismiss } = useNotification();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const diagnosticSummary = issueDiagnosticSummary(issue);
  const inline = isInlineIssueAction(issue.action);
  const presentation = issueActionPresentation(issue.action, actions);
  const message = diagnosticSummary ? `${presentation.guidance}\n${diagnosticSummary}` : presentation.guidance;

  useEffect(() => {
    if (inline) {
      dismiss();
      (actionsRef.current?.editInput ?? defaultEditInputFocus)();
      return;
    }
    const next = issueActionPresentation(issue.action, actionsRef.current);
    show({
      level: issue.severity === "error" ? "error" : "warning",
      title: issueTitle(issue),
      message: diagnosticSummary ? `${next.guidance}\n${diagnosticSummary}` : next.guidance,
      ...(next.label && next.onAction
        ? { action: { label: next.label, onPress: next.onAction } }
        : {}),
    });
  }, [diagnosticSummary, dismiss, inline, issue.action, issue.code, issue.severity, issue.userMessage, show]);

  if (!inline) return null;

  return (
    <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
      <strong>{issueTitle(issue)}</strong>
      <small>{message}</small>
    </aside>
  );
}
