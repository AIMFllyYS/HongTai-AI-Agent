import { useCallback, useEffect, useMemo, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, TaskEventRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskProgressSteps } from "../components/TaskProgressSteps";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { buildTaskStagePresentations, platformLabel } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, pathForRoute, taskDetailPath, type Navigate } from "../router";

export interface TaskProcessingPageProps {
  readonly runtime: AppRuntime;
  readonly taskId: string;
  readonly navigate: Navigate;
}

function mergeEvents(existing: readonly TaskEventRecord[], incoming: TaskEventRecord): readonly TaskEventRecord[] {
  const bySequence = new Map(existing.map((event) => [event.sequence, event]));
  bySequence.set(incoming.sequence, incoming);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function newestIssue(task: AppTaskRecord | undefined, events: readonly TaskEventRecord[], localIssue: TaskIssue | undefined): TaskIssue | undefined {
  if (localIssue) return localIssue;
  const eventIssue = events.slice().sort((left, right) => right.sequence - left.sequence).find((event) => event.issue)?.issue;
  const taskIssues = task?.issues;
  return eventIssue ?? (taskIssues && taskIssues.length > 0 ? taskIssues[taskIssues.length - 1] : undefined);
}

export function TaskProcessingPage({ runtime, taskId, navigate }: TaskProcessingPageProps) {
  const ingestAvailable = runtime.features.ingest === "available";
  const [task, setTask] = useState<AppTaskRecord>();
  const [events, setEvents] = useState<readonly TaskEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [actionPending, setActionPending] = useState<"start">();

  const load = useCallback(async () => {
    try {
      const [nextTask, nextEvents] = await Promise.all([
        runtime.tasks.get(taskId),
        runtime.tasks.listEvents(taskId),
      ]);
      setTask(nextTask);
      setEvents(nextEvents.slice().sort((left, right) => left.sequence - right.sequence));
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务进度暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, taskId]);

  useAppResume(load);

  useEffect(() => {
    void load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = runtime.tasks.subscribe(taskId, (event) => {
        setEvents((current) => mergeEvents(current, event));
        void runtime.tasks.get(taskId).then(setTask).catch((error: unknown) => {
          setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务状态暂时无法更新", action: "none" }));
        });
      });
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务进度订阅暂时不可用", action: "none" }));
    }
    return () => unsubscribe?.();
  }, [load, runtime, taskId]);

  const steps = useMemo(() => task ? buildTaskStagePresentations(task, events) : [], [events, task]);
  const activeIssue = newestIssue(task, events, issue);

  const start = async () => {
    setActionPending("start");
    try {
      await runtime.tasks.start(taskId);
      await load();
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "任务无法开始执行", action: "retry" }));
    } finally {
      setActionPending(undefined);
    }
  };

  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    ...(task && (task.media.length > 0 || Boolean(task.speechStatus) || task.status === "degraded" || task.status === "succeeded")
      ? { partialResult: () => navigate(taskDetailPath(task.id)) }
      : {}),
  };

  if (loading) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="采集任务"><LoadingState description="正在读取已保存任务与阶段事件" title="读取任务进度" /></AppShell>;
  }

  if (!task) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="采集任务"><div className="page-stack page-task-processing">{issue ? <IssueNotice issue={issue} /> : null}<ErrorState action={<Button onClick={() => navigate(pathForRoute("home"))} variant="secondary">重新提交链接</Button>} description={issue?.userMessage ?? "该任务不存在，或本机无法读取它的安全投影。"} title="找不到本地任务" /></div></AppShell>;
  }

  const localVideo = task.sourceKind === "local_video";
  const source = localVideo ? "我上传的视频 · 已安全保存在本机" : safeUrlForDisplay(task.sourceUrl);
  const platform = localVideo ? "本地上传" : platformLabel(task.platform);
  const needsNewSubmission = task.status === "failed" || task.status === "interrupted" || task.status === "cancelled";

  return (
    <AppShell activeNav="home" backPath="/" navigate={navigate} title="采集任务">
      <div className="page-stack page-task-processing">
        <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />
        <section className="task-processing-hero">
          <span className={`task-processing-hero__orb ${task.status === "running" ? "is-running" : ""}`.trim()}><Icon name={task.status === "succeeded" || task.status === "degraded" ? "check_circle" : task.status === "failed" || task.status === "interrupted" ? "error" : "sync"} size={31} /></span>
          <div>
            <div className="task-processing-hero__line"><h2>{localVideo ? "本地视频处理任务" : platform ? `${platform}采集任务` : "本地采集任务"}</h2><TaskStatusBadge status={task.status} /></div>
            <p className="technical-value">{source}</p>
          </div>
        </section>

        {activeIssue ? <IssueNotice actions={issueActions} issue={activeIssue} /> : null}

        <GlassCard className="task-stage-card">
          <div className="section-heading"><div><span className="eyebrow">处理进度</span><h3>正在处理内容</h3></div><span className="task-stage-card__count">{events.length} 条进度</span></div>
          <TaskProgressSteps steps={steps} />
        </GlassCard>

        {task.status === "queued" ? <EmptyState description="任务已经创建，但尚未开始。点击下方按钮才会启动本地执行。" icon="pending" title="等待开始" /> : null}
        {task.status === "cancelled" ? <EmptyState description="这是历史停止任务。本版本不会从这里继续运行；如需再次处理，请返回首页重新提交链接。" icon="pending" title="任务已停止" /> : null}
        {task.status === "failed" || task.status === "interrupted" ? <EmptyState description={localVideo ? "视频仍保存在本机。请查看上方提示，处理后重新选择视频。" : "已经获取到的内容仍会保留。请查看上方提示，处理后重新提交链接。"} icon="error" title={task.status === "interrupted" ? "处理已中断" : "这次处理没有完成"} /> : null}

        <div className="task-page-actions mobile-action-group">
          {task.status === "queued" ? <Button disabled={!ingestAvailable || actionPending !== undefined} icon={<Icon name="bolt" size={18} />} onClick={() => void start()}>{actionPending === "start" ? "正在启动" : "开始执行"}</Button> : null}
          {needsNewSubmission ? <Button icon={<Icon name="sync" size={18} />} onClick={() => navigate(pathForRoute("home"))} variant="secondary">{localVideo ? "重新选择视频" : "重新提交链接"}</Button> : null}
          {task.status === "succeeded" || task.status === "degraded" || task.status === "failed" || task.status === "cancelled" || task.status === "interrupted" ? <Button icon={<Icon name="chevron_right" size={18} />} onClick={() => navigate(taskDetailPath(task.id))} variant="ghost">查看任务详情</Button> : null}
        </div>
      </div>
    </AppShell>
  );
}
