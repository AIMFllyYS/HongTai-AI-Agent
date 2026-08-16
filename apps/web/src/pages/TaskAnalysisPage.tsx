import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, ContentAnalysisRecord, StructuredGenerationProgressV1, TaskDetailRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { ContentAnalysisDocument } from "../components/ContentAnalysisDocument";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { contentAnalysisModuleDefinitions } from "../features/tasks/content-analysis-module-progress";
import { LatestReadGuard, preferNewerByUpdatedAt } from "../features/tasks/latest-read-guard";
import { platformLabel, readContentAnalysis } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, pathForRoute, taskDetailPath, type Navigate } from "../router";

export interface TaskAnalysisPageProps {
  readonly runtime: AppRuntime;
  readonly taskId: string;
  readonly navigate: Navigate;
}

export function TaskAnalysisPage({ runtime, taskId, navigate }: TaskAnalysisPageProps) {
  const [detail, setDetail] = useState<TaskDetailRecord>();
  const [record, setRecord] = useState<ContentAnalysisRecord>();
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [progress, setProgress] = useState<StructuredGenerationProgressV1>();
  const latestRead = useRef(new LatestReadGuard());

  const load = useCallback(async () => {
    const generation = latestRead.current.begin();
    try {
      const [nextDetail, nextRecord] = await Promise.all([
        runtime.tasks.getDetail(taskId),
        runtime.analysis.get(taskId),
      ]);
      if (!latestRead.current.isCurrent(generation)) return;
      setDetail(nextDetail);
      setRecord((current) => preferNewerByUpdatedAt(current, nextRecord));
      setReadIssue(undefined);
    } catch (error) {
      if (!latestRead.current.isCurrent(generation)) return;
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "内容拆解状态暂时无法读取", action: "none" }));
    } finally {
      if (latestRead.current.isCurrent(generation)) setLoading(false);
    }
  }, [runtime, taskId]);

  useAppResume(load);

  useEffect(() => {
    void load();
    let unsubscribeTaskChange: (() => void) | undefined;
    let unsubscribeAnalysis: (() => void) | undefined;
    try {
      unsubscribeTaskChange = runtime.tasks.subscribeChanges((event) => {
        if (event.type === "deleted" && event.taskId === taskId) {
          setDetail(undefined);
          return;
        }
        if (event.type === "upsert" && event.task.id === taskId) {
          setDetail((current) => current ? { ...current, task: event.task } : current);
          void load();
        }
      });
      unsubscribeAnalysis = runtime.analysis.subscribe(taskId, (event) => {
        if (event.type === "progress") setProgress(event.progress);
        if (event.type === "failed") {
          setProgress(event.progress);
          setIssue(event.issue);
          void load();
        }
        if (event.type === "completed") {
          setRecord((current) => preferNewerByUpdatedAt(current, event.record));
          setProgress(undefined);
          setIssue(undefined);
        }
      });
    } catch (error) {
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "内容拆解自动更新暂时不可用", action: "none" }));
    }
    return () => {
      latestRead.current.invalidate();
      unsubscribeTaskChange?.();
      unsubscribeAnalysis?.();
    };
  }, [load, runtime, taskId]);

  if (loading) {
    return <AppShell activeNav="home" backPath={taskDetailPath(taskId)} navigate={navigate} title="内容拆解"><LoadingState description="正在读取已保存的内容" title="加载拆解结果" /></AppShell>;
  }
  if (!detail) {
    const unavailableIssue = readIssue ?? issue;
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="内容拆解"><div className="page-stack page-task-analysis">{unavailableIssue ? <IssueNotice issue={unavailableIssue} /> : null}<ErrorState description={unavailableIssue?.userMessage ?? "该任务不存在，或没有可读取的本地详情。"} title="找不到任务" /></div></AppShell>;
  }

  const analysisAvailable = runtime.features.contentAnalysis === "available";
  const analysis = record ? readContentAnalysis(record) : undefined;
  const recordIssue = readIssue ?? issue ?? record?.issue;
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    ...(detail.evidenceUnits.length > 0 ? { partialResult: () => navigate(taskDetailPath(taskId)) } : {}),
  };
  const localVideo = detail.task.sourceKind === "local_video";
  const sourceTitle = detail.content.title ?? (localVideo ? "本地上传视频拆解" : "内容拆解");
  const sourceUrl = localVideo ? "本地上传 · 仅使用已保存文稿证据" : safeUrlForDisplay(detail.content.canonicalUrl ?? detail.task.sourceUrl);
  const platform = localVideo ? "本地上传" : platformLabel(detail.task.platform);

  return (
    <AppShell activeNav="home" backPath={taskDetailPath(taskId)} navigate={navigate} title="内容拆解">
      <div className="page-stack page-task-analysis">
        <section className="task-analysis-heading">
          <span className="eyebrow">CONTENT-ANALYSIS.V1</span>
          <h2>{sourceTitle}</h2>
          <p className="technical-value">{sourceUrl}</p>
          {platform ? <span><Icon name="language" size={15} />{platform}</span> : null}
        </section>

        {recordIssue ? <IssueNotice actions={issueActions} issue={recordIssue} /> : null}
        {!analysisAvailable && record?.status !== "succeeded" ? <TaskCapabilityNotice capability={runtime.features.contentAnalysis} feature="contentAnalysis" /> : null}

        {!record || record.status === "not_started" ? (
          <EmptyState action={<Button icon={<Icon name="arrow_back" size={17} />} onClick={() => navigate(taskDetailPath(taskId))} variant="secondary">返回任务详情</Button>} description="请返回任务详情，确认后开始分析。" icon="analytics" title="还没有开始拆解" />
        ) : null}
        {record?.status === "running" || progress ? <ValidatedModuleProgress definitions={contentAnalysisModuleDefinitions} failedTitle="这次拆解没有完成" issue={issue ?? record?.issue} progress={progress} title="AI 正在整理内容" /> : null}
        {record?.status === "failed" ? <ErrorState action={<Button icon={<Icon name="arrow_back" size={17} />} onClick={() => navigate(taskDetailPath(taskId))} variant="secondary">返回任务详情</Button>} description="上一次拆解没有生成完整结果。请按上方提示处理后，再决定是否重新运行。" title="这次拆解没有完成" /> : null}
        {record?.status === "succeeded" && !analysis?.available ? <ErrorState description="保存的结果不完整，请重新拆解。" title="暂时无法展示结果" /> : null}
        {record?.status === "succeeded" && analysis?.available ? <ContentAnalysisDocument analysis={analysis} evidenceUnits={detail.evidenceUnits} /> : null}
        {record?.status === "succeeded" && analysis?.available ? <Button icon={<Icon name="bookmark" size={17} />} onClick={() => navigate(pathForRoute("templates"))} variant="secondary">前往模板管理保存结构</Button> : null}

        <GlassCard className="task-analysis-footer">
          <span><Icon name="info" size={18} />分析过程不会保留；页面只保存最终结果和对应的原始内容。</span>
          {readIssue ? <Button onClick={() => void load()} variant="quiet">重新读取本地结果</Button> : null}
        </GlassCard>
      </div>
    </AppShell>
  );
}
