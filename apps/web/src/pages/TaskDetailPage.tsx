import { useCallback, useEffect, useMemo, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, MediaReference, StructuredStreamProgress as StructuredStreamProgressValue, TaskDetailRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanels";
import { StructuredStreamProgress } from "../components/StructuredStreamProgress";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { contentTypeLabel, formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
import { aiSettingsPath, pathForRoute, taskAnalysisPath, type Navigate } from "../router";

export interface TaskDetailPageProps {
  readonly runtime: AppRuntime;
  readonly taskId: string;
  readonly navigate: Navigate;
}

function uniqueMedia(media: readonly MediaReference[]): readonly MediaReference[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    if (seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
}

export function TaskDetailPage({ runtime, taskId, navigate }: TaskDetailPageProps) {
  const [detail, setDetail] = useState<TaskDetailRecord>();
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"analysis">();
  const [streamProgress, setStreamProgress] = useState<StructuredStreamProgressValue>();

  const load = useCallback(async () => {
    try {
      const nextDetail = await runtime.tasks.getDetail(taskId);
      setDetail(nextDetail);
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "任务详情暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAnalysis = async () => {
    setPendingAction("analysis");
    setIssue(undefined);
    setStreamProgress(undefined);
    try {
      await runtime.analysis.run(taskId, async (event) => {
        if (event.type === "progress") setStreamProgress(event.progress);
        if (event.type === "failed") setIssue(event.issue);
      });
      navigate(taskAnalysisPath(taskId));
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "内容拆解无法开始", action: "none" }));
    } finally {
      setPendingAction(undefined);
      setConfirmationOpen(false);
    }
  };

  const imageMedia = useMemo(() => detail ? uniqueMedia([
    ...detail.media.filter((item) => item.kind === "image"),
    ...(detail.content.cover ? [detail.content.cover] : []),
  ]) : [], [detail]);
  const video = detail?.media.find((item) => item.kind === "video");
  const audio = detail?.media.find((item) => item.kind === "audio");

  if (loading) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="任务详情"><LoadingState description="正在从本地仓储读取已保存的产物投影" title="读取任务详情" /></AppShell>;
  }
  if (!detail) {
    return <AppShell activeNav="home" backPath="/" navigate={navigate} title="任务详情"><div className="page-stack page-task-detail">{issue ? <IssueNotice issue={issue} /> : null}<ErrorState description={issue?.userMessage ?? "该任务不存在，或没有可展示的本地详情。"} title="找不到任务详情" /></div></AppShell>;
  }

  const task = detail.task;
  const platform = platformLabel(task.platform);
  const contentType = contentTypeLabel(task.contentType);
  const activeIssue = issue ?? task.issues[task.issues.length - 1];
  const needsNewSubmission = task.status === "failed" || task.status === "interrupted" || task.status === "cancelled";
  const hasEvidence = detail.evidenceUnits.length > 0;
  const terminalWithOutput = task.status === "succeeded" || task.status === "degraded";
  const analysisAvailable = runtime.features.contentAnalysis === "available";
  const canRequestAnalysis = analysisAvailable && terminalWithOutput && hasEvidence && task.analysisStatus === "not_started";
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
  };

  return (
    <AppShell activeNav="home" backPath="/" navigate={navigate} title="任务详情">
      <div className="page-stack page-task-detail">
        <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />
        {activeIssue ? <IssueNotice actions={issueActions} issue={activeIssue} /> : null}

        <GlassCard className="task-detail-summary">
          <div className="task-detail-summary__heading"><div><span className="eyebrow">LOCAL TASK</span><h2>{detail.content.title ?? "未提供标题"}</h2></div><TaskStatusBadge status={task.status} /></div>
          <p className="technical-value">{safeUrlForDisplay(detail.content.canonicalUrl ?? task.sourceUrl)}</p>
          <div className="task-detail-summary__facts">
            {platform ? <span><Icon name="language" size={15} />{platform}</span> : null}
            {contentType ? <span><Icon name={task.contentType === "image_text" ? "grid" : "video_file"} size={15} />{contentType}</span> : null}
            {detail.content.author ? <span><Icon name="face" size={15} />{detail.content.author}</span> : null}
            {detail.content.durationSeconds === undefined ? null : <span><Icon name="update" size={15} />{detail.content.durationSeconds} 秒</span>}
            {formatTaskTime(task.updatedAt) ? <span><Icon name="history" size={15} />{formatTaskTime(task.updatedAt)}</span> : null}
          </div>
          {detail.content.description ? <div className="task-detail-summary__description">{detail.content.description}</div> : null}
        </GlassCard>

        <section className="page-section">
          <div className="section-heading"><h3>{task.contentType === "image_text" ? "已保存图片" : "已保存媒体"}</h3><span className="analysis-count">{detail.media.length} 个文件</span></div>
          {task.contentType === "image_text" ? (
            imageMedia.length === 0 ? <EmptyState description="任务没有可展示的已保存图片。" icon="folder_open" title="暂无图片" /> : <div className="runtime-image-gallery">{imageMedia.map((media) => <RuntimeMediaFrame className="runtime-image-gallery__item" key={media.uri} label={media.displayName ?? "已保存图片"} media={media} />)}</div>
          ) : video ? <RuntimeMediaFrame className="runtime-video-frame" label={detail.content.title ?? "已保存视频"} media={video} /> : detail.content.cover ? <RuntimeMediaFrame className="runtime-video-frame" label={detail.content.title ?? "已保存封面"} media={detail.content.cover} /> : <EmptyState description="任务没有可展示的已保存视频或封面。" icon="folder_open" title="暂无媒体" />}
          {audio ? <RuntimeMediaFrame className="runtime-audio-frame" label={audio.displayName ?? "已保存音频"} media={audio} /> : null}
        </section>

        {task.contentType === "video" ? (
          <section className="page-section">
            <div className="section-heading"><h3>原始文稿</h3>{task.speechStatus ? <span className="analysis-count">{task.speechStatus === "transcribed" ? "已转写" : task.speechStatus === "no_speech" ? "未检测到口播" : "转写未完成"}</span> : null}</div>
            {task.speechStatus === "no_speech" ? <EmptyState description="本次媒体没有检测到有效口播。这是正常结果，不会用平台描述伪装成语音转写。" icon="voice" title="未检测到有效口播" /> : detail.transcript && (detail.transcript.text || detail.transcript.segments.length > 0) ? (
              <GlassCard className="runtime-transcript-card">
                {detail.transcript.text ? <p className="runtime-transcript-card__full">{detail.transcript.text}</p> : null}
                {detail.transcript.segments.length > 0 ? <ol>{detail.transcript.segments.map((segment) => <li key={segment.id}><time>{segment.startSeconds === undefined ? "" : `${segment.startSeconds}s`}</time><p>{segment.text}</p></li>)}</ol> : null}
              </GlassCard>
            ) : <EmptyState description={task.speechStatus === "failed" ? "文稿处理未完成，未找到可安全展示的部分文稿。" : "任务尚未保存可展示的文稿。"} icon="record_voice_over" title="暂无文稿" />}
          </section>
        ) : null}

        {task.contentType === "image_text" ? (
          <section className="page-section">
            <div className="section-heading"><h3>图文正文</h3><span className="analysis-count">{detail.imageText?.paragraphs.length ?? 0} 段</span></div>
            {detail.imageText?.text || detail.imageText?.paragraphs.length ? <GlassCard className="runtime-transcript-card"><p className="runtime-transcript-card__full">{detail.imageText?.text}</p>{detail.imageText?.paragraphs.length ? <ol>{detail.imageText.paragraphs.map((paragraph) => <li key={paragraph.id}><p>{paragraph.text}</p></li>)}</ol> : null}</GlassCard> : <EmptyState description="任务没有保存可展示的图文正文。" icon="file" title="暂无正文" />}
          </section>
        ) : null}

        <section className="page-section">
          <div className="section-heading"><div><span className="eyebrow">CONTENT-ANALYSIS.V1</span><h3>AI 自动拆解</h3></div><span className="analysis-count">{hasEvidence ? `${detail.evidenceUnits.length} 条证据` : "无可用证据"}</span></div>
          <TaskCapabilityNotice capability={runtime.features.contentAnalysis} feature="contentAnalysis" />
          {!hasEvidence ? <EmptyState description="该任务没有可展示的文稿或图文证据，不能生成缺少依据的拆解结论。" icon="folder_open" title="暂不能拆解" /> : null}
          {task.analysisStatus === "succeeded" ? <GlassCard className="analysis-request-card"><p>已保存正式内容拆解结果。</p><Button icon={<Icon name="analytics" size={18} />} onClick={() => navigate(taskAnalysisPath(task.id))}>查看拆解结果</Button></GlassCard> : null}
          {task.analysisStatus === "running" ? <GlassCard className="analysis-request-card"><Icon name="sync" size={22} /><p>内容拆解正在运行。采集七阶段不会因此增加新阶段。</p><Button onClick={() => navigate(taskAnalysisPath(task.id))} variant="secondary">查看当前状态</Button></GlassCard> : null}
          {task.analysisStatus === "failed" ? <GlassCard className="analysis-request-card"><Icon name="error" size={22} /><p>上一次内容拆解没有成功完成。请先查看真实错误状态，再由你确认是否重新运行。</p><Button onClick={() => navigate(taskAnalysisPath(task.id))} variant="secondary">查看拆解状态</Button></GlassCard> : null}
          {canRequestAnalysis ? (
            confirmationOpen ? <GlassCard className="analysis-confirm-card"><strong>确认运行 AI 自动拆解？</strong><p>系统将基于此任务已保存的 {detail.evidenceUnits.length} 条证据生成 content-analysis.v1，不会把它写入采集阶段。</p><div className="analysis-confirm-card__actions mobile-action-group"><Button disabled={pendingAction === "analysis"} onClick={() => void runAnalysis()}>{pendingAction === "analysis" ? "正在接收结构化内容" : "确认运行"}</Button><Button disabled={pendingAction === "analysis"} onClick={() => setConfirmationOpen(false)} variant="quiet">暂不运行</Button></div></GlassCard> : <Button disabled={pendingAction !== undefined} icon={<Icon name="auto_awesome" size={18} />} onClick={() => setConfirmationOpen(true)}>AI 自动拆解</Button>
          ) : task.analysisStatus === "not_started" && analysisAvailable && !terminalWithOutput ? <EmptyState description="采集任务完成或部分完成后，才可以确认运行内容拆解。" icon="pending" title="等待可用产物" /> : null}
          {pendingAction === "analysis" ? <StructuredStreamProgress progress={streamProgress} title="AI 正在拆解真实证据" /> : null}
        </section>

        {needsNewSubmission ? <GlassCard className="analysis-request-card"><Icon name="sync" size={22} /><p>本版本不会继续或复制旧任务。若需再次处理，请返回首页重新提交链接。</p><Button icon={<Icon name="arrow_back" size={18} />} onClick={() => navigate(pathForRoute("home"))} variant="secondary">重新提交链接</Button></GlassCard> : null}
        <Button icon={<Icon name="update" size={18} />} onClick={() => void load()} variant="quiet">刷新本地详情</Button>
      </div>
    </AppShell>
  );
}
