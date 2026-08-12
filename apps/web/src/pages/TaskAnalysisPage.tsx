import { useCallback, useEffect, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, ContentAnalysisRecord, TaskDetailRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { ContentAnalysisDocument } from "../components/ContentAnalysisDocument";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { platformLabel, readContentAnalysis } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, taskDetailPath, type Navigate } from "../router";

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

  const load = useCallback(async () => {
    try {
      const [nextDetail, nextRecord] = await Promise.all([
        runtime.tasks.getDetail(taskId),
        runtime.analysis.get(taskId),
      ]);
      setDetail(nextDetail);
      setRecord(nextRecord);
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "内容拆解状态暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, taskId]);

  useAppResume(load);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <AppShell activeNav="home" backPath={taskDetailPath(taskId)} navigate={navigate} title="内容拆解"><LoadingState description="正在读取已保存的拆解状态和真实证据" title="读取内容拆解" /></AppShell>;
  }
  if (!detail) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="内容拆解"><div className="page-stack page-task-analysis">{issue ? <IssueNotice issue={issue} /> : null}<ErrorState description={issue?.userMessage ?? "该任务不存在，或没有可读取的本地详情。"} title="找不到任务" /></div></AppShell>;
  }

  const analysisAvailable = runtime.features.contentAnalysis === "available";
  const analysis = record ? readContentAnalysis(record) : undefined;
  const recordIssue = issue ?? record?.issue;
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
  };
  const sourceTitle = detail.content.title ?? "内容拆解";
  const sourceUrl = safeUrlForDisplay(detail.content.canonicalUrl ?? detail.task.sourceUrl);
  const platform = platformLabel(detail.task.platform);

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
          <EmptyState action={<Button icon={<Icon name="arrow_back" size={17} />} onClick={() => navigate(taskDetailPath(taskId))} variant="secondary">返回任务详情确认拆解</Button>} description="内容拆解不会自动开始。请在任务详情确认后，才会基于真实证据运行 AI 自动拆解。" icon="analytics" title="尚未开始拆解" />
        ) : null}
        {record?.status === "running" ? <LoadingState description="拆解正在独立于采集七阶段运行。若本次由任务详情启动，实时结构区块会显示在那里；正式结果仍须通过 Schema 和证据校验后才会保存。" title="AI 正在拆解真实证据" /> : null}
        {record?.status === "failed" ? <ErrorState action={<Button icon={<Icon name="arrow_back" size={17} />} onClick={() => navigate(taskDetailPath(taskId))} variant="secondary">返回任务详情</Button>} description="上一次拆解没有生成可展示的正式结果。请查看上方稳定错误代码后，由你确认是否再次运行。" title="内容拆解未完成" /> : null}
        {record?.status === "succeeded" && !analysis?.available ? <ErrorState description="已保存的结果不符合 content-analysis.v1 展示契约，应用不会猜测或补写字段。" title="无法安全展示拆解结果" /> : null}
        {record?.status === "succeeded" && analysis?.available ? <ContentAnalysisDocument analysis={analysis} evidenceUnits={detail.evidenceUnits} /> : null}

        <GlassCard className="task-analysis-footer">
          <span><Icon name="info" size={18} />只展示正式结果和真实证据；不展示供应商 reasoning、原始响应或平台私有请求数据。</span>
          <Button onClick={() => void load()} variant="quiet">刷新本地结果</Button>
        </GlassCard>
      </div>
    </AppShell>
  );
}
