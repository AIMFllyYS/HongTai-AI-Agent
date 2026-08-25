import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ContentAnalysisRecord, StructuredGenerationProgressV1, TaskChangeEventV1, TaskDetailRecord, TaskEventRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { IssueNotice } from "../components/IssueNotice";
import { ErrorState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { LiveListReadReconciler } from "../features/generation/live-list-read-reconciler";
import { LatestReadGuard, preferNewerByUpdatedAt } from "../features/tasks/latest-read-guard";
import { useAppResume } from "../hooks/useAppResume";
import { pathForRoute, type Navigate } from "../router";
import { TaskDetailPage, type TaskCompletedChrome } from "./TaskDetailPage";
import { applyTaskDetailChange, completedTaskShellTitle, mergeEvents, newestIssue, resolveTaskPageSurface, syncTaskResultTabPath, taskResultTabFromPath, type TaskResultTab } from "./task-page-model";
import { TaskProcessingPage } from "./TaskProcessingPage";

export interface TaskPageProps {
  readonly runtime: AppRuntime;
  readonly taskId: string;
  readonly navigate: Navigate;
}

export function TaskPage({ runtime, taskId, navigate }: TaskPageProps) {
  const latestRead = useRef(new LatestReadGuard());
  const detailRead = useRef(new LatestReadGuard());
  const detailChanges = useRef(new LiveListReadReconciler<TaskChangeEventV1>());
  const [task, setTask] = useState<AppTaskRecord>();
  const [events, setEvents] = useState<readonly TaskEventRecord[]>([]);
  const [detail, setDetail] = useState<TaskDetailRecord>();
  const [record, setRecord] = useState<ContentAnalysisRecord>();
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [streamProgress, setStreamProgress] = useState<StructuredGenerationProgressV1>();
  const [resultTab, setResultTab] = useState<TaskResultTab>(() => taskResultTabFromPath(typeof window === "undefined" ? "" : window.location.pathname));
  const [completedChrome, setCompletedChrome] = useState<TaskCompletedChrome>({});

  const loadProcessing = useCallback(async () => {
    const generation = latestRead.current.current();
    try {
      const [nextTask, nextEvents] = await Promise.all([
        runtime.tasks.get(taskId),
        runtime.tasks.listEvents(taskId),
      ]);
      if (!latestRead.current.isCurrent(generation)) return;
      setTask((current) => preferNewerByUpdatedAt(current, nextTask));
      setEvents((current) => current.reduce((merged, event) => mergeEvents(merged, event), nextEvents));
      setIssue(undefined);
    } catch (error) {
      if (!latestRead.current.isCurrent(generation)) return;
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务进度暂时无法读取", action: "none" }));
    }
  }, [runtime, taskId]);

  const loadDetail = useCallback(async () => {
    const generation = detailRead.current.begin();
    const read = detailChanges.current.beginRead();
    try {
      const [nextDetail, nextRecord] = await Promise.all([
        runtime.tasks.getDetail(taskId),
        runtime.analysis.get(taskId),
      ]);
      if (!detailRead.current.isCurrent(generation)) {
        detailChanges.current.abandon(read);
        return;
      }
      const reconciled = detailChanges.current.reconcile(
        read,
        nextDetail,
        (current, event) => applyTaskDetailChange(current, event, taskId),
      );
      if (reconciled === undefined) return;
      setDetail(reconciled);
      setRecord((current) => preferNewerByUpdatedAt(current, nextRecord));
      setReadIssue(undefined);
    } catch (error) {
      if (!detailRead.current.isCurrent(generation)) {
        detailChanges.current.abandon(read);
        return;
      }
      detailChanges.current.abandon(read);
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务详情暂时无法读取", action: "none" }));
    }
  }, [runtime, taskId]);

  const load = useCallback(async () => {
    const generation = latestRead.current.current();
    await Promise.all([loadProcessing(), loadDetail()]);
    if (latestRead.current.isCurrent(generation)) setLoading(false);
  }, [loadDetail, loadProcessing]);

  useAppResume(load);

  useEffect(() => {
    setResultTab(taskResultTabFromPath(typeof window === "undefined" ? "" : window.location.pathname));
  }, [taskId]);

  useEffect(() => {
    const sync = () => setResultTab(taskResultTabFromPath(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const selectResultTab = useCallback((tab: TaskResultTab) => {
    setResultTab(tab);
    syncTaskResultTabPath(taskId, tab);
  }, [taskId]);

  const onChromeChange = useCallback((chrome: TaskCompletedChrome) => {
    setCompletedChrome(chrome);
  }, []);

  useEffect(() => {
    void load();
    let unsubscribeEvents: (() => void) | undefined;
    let unsubscribeTaskChange: (() => void) | undefined;
    let unsubscribeAnalysis: (() => void) | undefined;
    try {
      unsubscribeEvents = runtime.tasks.subscribe(taskId, (event) => {
        setEvents((current) => mergeEvents(current, event));
        const generation = latestRead.current.current();
        void runtime.tasks.get(taskId).then((nextTask) => {
          if (!latestRead.current.isCurrent(generation)) return;
          setTask((current) => preferNewerByUpdatedAt(current, nextTask));
        }).catch((error: unknown) => {
          if (!latestRead.current.isCurrent(generation)) return;
          setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务状态暂时无法更新", action: "none" }));
        });
      });
      unsubscribeTaskChange = runtime.tasks.subscribeChanges((event) => {
        detailChanges.current.record(event);
        if (event.type === "deleted" && event.taskId === taskId) {
          setDetail(undefined);
          return;
        }
        if (event.type === "upsert" && event.task.id === taskId) {
          setTask((current) => preferNewerByUpdatedAt(current, event.task));
          setDetail((current) => applyTaskDetailChange(current, event, taskId));
          void loadDetail();
        }
      });
      unsubscribeAnalysis = runtime.analysis.subscribe(taskId, (event) => {
        if (event.type === "progress") setStreamProgress(event.progress);
        if (event.type === "failed") {
          setStreamProgress(event.progress);
          setIssue(event.issue);
          void loadDetail();
        }
        if (event.type === "completed") {
          setRecord((current) => preferNewerByUpdatedAt(current, event.record));
          setStreamProgress(undefined);
          setIssue(undefined);
        }
      });
    } catch (error) {
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务自动更新暂时不可用", action: "none" }));
    }
    return () => {
      latestRead.current.invalidate();
      detailRead.current.invalidate();
      unsubscribeEvents?.();
      unsubscribeTaskChange?.();
      unsubscribeAnalysis?.();
    };
  }, [load, loadDetail, runtime, taskId]);

  const scrollToPartial = () => {
    if (typeof document === "undefined") return;
    document.getElementById("task-detail-summary")?.scrollIntoView({ block: "start" });
  };

  const surface = resolveTaskPageSurface({
    loading,
    status: task?.status,
    hasDetail: detail !== undefined,
  });

  const showSkeleton = useSkeletonHold(surface === "loading");
  if (showSkeleton) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} showNav={false} title="拆解详情"><PageSkeleton layout="task" /></AppShell>;
  }

  if (surface === "missing-task" || !task) {
    const unavailableIssue = readIssue ?? issue;
    return (
      <AppShell activeNav="home" backPath="/" navigate={navigate} showNav={false} title="拆解详情">
        <div className="page-stack page-task-processing">
          {unavailableIssue ? <IssueNotice issue={unavailableIssue} /> : null}
          <ErrorState action={<Button onClick={() => navigate(pathForRoute("home"))} variant="secondary">重新提交链接</Button>} description={unavailableIssue?.userMessage ?? "该任务不存在，或本机无法读取它的安全投影。"} title="找不到本地任务" />
        </div>
      </AppShell>
    );
  }

  if (surface === "processing") {
    return (
      <AppShell activeNav="home" backPath="/" navigate={navigate} showNav={false} title="拆解详情">
        <TaskProcessingPage
          activeIssue={newestIssue(task, events, issue)}
          events={events}
          ingestAvailable={runtime.features.ingest === "available"}
          navigate={navigate}
          onPartialResult={scrollToPartial}
          onStarted={() => void loadProcessing()}
          runtime={runtime}
          task={task}
        />
      </AppShell>
    );
  }

  if (surface === "completed-missing" || !detail) {
    const unavailableIssue = readIssue ?? issue;
    return (
      <AppShell activeNav="home" backPath="/" navigate={navigate} showNav={false} title={completedTaskShellTitle(task.analysisStatus)}>
        <div className="page-stack page-task-detail">
          {unavailableIssue ? <IssueNotice issue={unavailableIssue} /> : null}
          <ErrorState description={unavailableIssue?.userMessage ?? "该任务不存在，或没有可展示的本地详情。"} title="找不到任务详情" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeNav="home" backPath="/" contextualAction={completedChrome.contextualAction} headerAction={completedChrome.headerAction} navigate={navigate} showNav={false} title={completedTaskShellTitle(task.analysisStatus)}>
      <div className="page-stack page-task-detail">
        <TaskDetailPage
          activeTab={resultTab}
          detail={detail}
          issue={issue}
          navigate={navigate}
          onChromeChange={onChromeChange}
          onReload={load}
          onSelectTab={selectResultTab}
          readIssue={readIssue}
          record={record}
          runtime={runtime}
          streamProgress={streamProgress}
        />
      </div>
    </AppShell>
  );
}
