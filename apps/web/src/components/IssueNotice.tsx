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
}

type HandledIssueAction = keyof TaskIssueActionHandlers;

interface IssueActionDescriptor {
  readonly label?: string;
  readonly guidance: string;
  readonly handler?: HandledIssueAction;
}

const actionDescriptors: Readonly<Record<TaskIssue["action"], IssueActionDescriptor>> = {
  edit_input: {
    guidance: "请检查输入内容后重新提交；应用不会替你修改或补全输入。",
  },
  retry: {
    label: "重试",
    guidance: "仅在当前页面提供真实重试操作时才会显示此按钮。",
    handler: "retry",
  },
  wait_and_retry: {
    guidance: "请稍后刷新真实状态；应用不会自动重试。",
  },
  check_network: {
    guidance: "请检查网络后刷新此页；应用不会伪造网络结果。",
  },
  configure_ai: {
    label: "前往 AI 设置",
    guidance: "请检查本地 AI 连接配置；只有页面提供跳转时才会显示此按钮。",
    handler: "configureAi",
  },
  free_storage: {
    guidance: "请释放本机存储空间后再手动重试。",
  },
  select_media: {
    label: "重新选择",
    guidance: "请重新选择所需媒体；应用不会构造替代文件。",
    handler: "selectMedia",
  },
  view_partial_result: {
    label: "查看部分结果",
    guidance: "仅当页面有已保存的真实产物时才会打开详情。",
    handler: "partialResult",
  },
  none: {
    guidance: "当前页面没有可安全自动执行的操作。",
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

/** Shared presentation mapping for stable application issue codes/actions. */
export function IssueNotice({ issue, actions }: IssueNoticeProps) {
  const { show } = useNotification();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const technicalCode = issueTechnicalCode(issue);
  const diagnosticSummary = issueDiagnosticSummary(issue);

  useEffect(() => {
    const presentation = issueActionPresentation(issue.action, actionsRef.current);
    show({
      level: issue.severity === "error" ? "error" : "warning",
      title: issue.userMessage,
      message: diagnosticSummary ? `${presentation.guidance}\n${diagnosticSummary}` : presentation.guidance,
      technicalCode,
      ...(presentation.label && presentation.onAction
        ? { action: { label: presentation.label, onPress: presentation.onAction } }
        : {}),
    });
  }, [diagnosticSummary, issue.action, issue.severity, issue.userMessage, show, technicalCode]);

  return null;
}
