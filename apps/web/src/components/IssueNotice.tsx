import { useEffect, useRef } from "react";
import type { TaskIssue } from "@hongtai/core";

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

  useEffect(() => {
    const presentation = issueActionPresentation(issue.action, actionsRef.current);
    show({
      level: issue.severity === "error" ? "error" : "warning",
      title: issue.userMessage,
      message: presentation.guidance,
      technicalCode,
      ...(presentation.label && presentation.onAction
        ? { action: { label: presentation.label, onPress: presentation.onAction } }
        : {}),
    });
  }, [issue.action, issue.severity, issue.userMessage, show, technicalCode]);

  return null;
}
