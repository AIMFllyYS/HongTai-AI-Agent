import type { TaskIssue } from "@hongtai/core";

import { Button } from "./Buttons";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

const actionCopy: Readonly<Record<TaskIssue["action"], string | undefined>> = {
  edit_input: "检查输入",
  retry: "重试",
  wait_and_retry: "稍后重试",
  check_network: "检查网络",
  configure_ai: "前往 AI 设置",
  free_storage: "释放存储空间",
  select_media: "重新选择",
  view_partial_result: "查看部分结果",
  none: undefined,
};

export interface IssueNoticeProps {
  readonly issue: TaskIssue;
  readonly onAction?: () => void;
  readonly className?: string;
}

/** Shared presentation mapping for stable application issue codes/actions. */
export function IssueNotice({ issue, onAction, className = "" }: IssueNoticeProps) {
  const actionLabel = actionCopy[issue.action];
  return (
    <GlassCard className={`issue-notice issue-notice--${issue.severity} ${className}`.trim()} data-issue-action={issue.action} data-issue-code={issue.code} tone="soft">
      <Icon name={issue.severity === "error" ? "error" : "info"} size={21} />
      <div>
        <strong>{issue.userMessage}</strong>
        <small>错误代码：{issue.code}</small>
      </div>
      {actionLabel && onAction ? <Button onClick={onAction} size="md" variant="quiet">{actionLabel}</Button> : null}
    </GlassCard>
  );
}
