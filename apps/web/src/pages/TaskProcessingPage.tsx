import { useMemo, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, TaskEventRecord, TaskIssue } from "@hongtai/core";

import { Button } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskProgressSteps } from "../components/TaskProgressSteps";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { buildTaskStagePresentations, platformLabel } from "../features/tasks/task-presenters";
import { aiSettingsPath, pathForRoute, type Navigate } from "../router";
import { showProcessingLeaveHint } from "./task-page-model";

export interface TaskProcessingPageProps {
  readonly runtime: AppRuntime;
  readonly task: AppTaskRecord;
  readonly events: readonly TaskEventRecord[];
  readonly activeIssue?: TaskIssue;
  readonly ingestAvailable: boolean;
  readonly navigate: Navigate;
  readonly onStarted: () => void;
  readonly onPartialResult: () => void;
}

export function TaskProcessingPage({
  runtime,
  task,
  events,
  activeIssue,
  ingestAvailable,
  navigate,
  onStarted,
  onPartialResult,
}: TaskProcessingPageProps) {
  const [actionPending, setActionPending] = useState<"start">();
  const [startIssue, setStartIssue] = useState<TaskIssue>();
  const steps = useMemo(() => buildTaskStagePresentations(task, events), [events, task]);
  const issue = startIssue ?? activeIssue;
  const localVideo = task.sourceKind === "local_video";
  const source = localVideo ? "我上传的视频 · 已安全保存在本机" : safeUrlForDisplay(task.sourceUrl);
  const platform = localVideo ? "本地上传" : platformLabel(task.platform);
  const doneCount = steps.filter((step) => step.status === "succeeded" || step.status === "degraded").length;
  const activeStep = steps.find((step) => step.status === "running") ?? steps.find((step) => step.status === "pending");
  const progressRatio = steps.length === 0 ? 0 : Math.min(1, doneCount / steps.length);
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    ...(task.media.length > 0 || Boolean(task.speechStatus) || task.status === "degraded" || task.status === "succeeded"
      ? { partialResult: onPartialResult }
      : {}),
  };

  const start = async () => {
    setActionPending("start");
    try {
      await runtime.tasks.start(task.id);
      setStartIssue(undefined);
      onStarted();
    } catch (error) {
      setStartIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "任务无法开始执行", action: "retry" }));
    } finally {
      setActionPending(undefined);
    }
  };

  return (
    <div className="page-stack page-task-processing">
      <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />
      <section className="task-processing-hero">
        <div>
          <div className="task-processing-hero__line">
            <h2>{localVideo ? "本地视频处理任务" : platform ? `${platform}采集任务` : "本地采集任务"}</h2>
            <TaskStatusBadge status={task.status} />
          </div>
          <p className="technical-value">{source}</p>
        </div>
      </section>

      {issue ? <IssueNotice actions={issueActions} issue={issue} /> : null}

      <section className="task-stage-card">
        <div className="task-stage-card__status">
          <strong>{activeStep?.detail || activeStep?.label || (task.status === "queued" ? "等待开始执行" : "正在处理内容")}</strong>
          <span>{doneCount}/{steps.length}</span>
        </div>
        <div aria-hidden="true" className="task-stage-card__meter">
          <span style={{ width: `${Math.round(progressRatio * 100)}%` }} />
        </div>
        <TaskProgressSteps steps={steps} />
      </section>

      {task.status === "queued" ? <EmptyState description="任务已经创建，但尚未开始。点击下方按钮才会启动本地执行。" icon="pending" title="等待开始" /> : null}

      <div className="task-page-actions mobile-action-group">
        {task.status === "queued" ? <Button variant="secondary" disabled={!ingestAvailable || actionPending !== undefined} icon={<Icon name="bolt" size={18} />} onClick={() => void start()}>{actionPending === "start" ? "正在启动" : "开始执行"}</Button> : null}
        {task.status === "failed" || task.status === "interrupted" || task.status === "cancelled" ? <Button icon={<Icon name="sync" size={18} />} onClick={() => navigate(pathForRoute("home"))} variant="secondary">{localVideo ? "重新选择视频" : "重新提交链接"}</Button> : null}
      </div>
      {showProcessingLeaveHint(task.status) ? <p className="task-processing-leave-hint">任务在后台运行，可以放心离开此页</p> : null}
    </div>
  );
}
