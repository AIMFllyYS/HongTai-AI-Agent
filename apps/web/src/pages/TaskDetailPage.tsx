import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, ContentAnalysisRecord, MediaReference, StructuredGenerationProgressV1, TaskDetailRecord, TaskIssue } from "@hongtai/core";

import { Button } from "../components/Buttons";
import { ConfirmDeleteSheet } from "../components/ConfirmDeleteSheet";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { EmptyState } from "../components/StatePanels";
import { TabPanel, Tabs, tabId, tabPanelId } from "../components/Tabs";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskMoreActionsSheet, type TaskMoreActionItem } from "../components/TaskMoreActionsSheet";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { contentAnalysisModuleDefinitions } from "../features/tasks/content-analysis-module-progress";
import { contentTypeLabel, formatTaskTime, mediaOrientationLabel, platformLabel } from "../features/tasks/task-presenters";
import { aiSettingsPath, pathForRoute, replicaWizardPath, type Navigate } from "../router";
import { formatStoredSize, totalMediaByteLength } from "../runtime/local-cache";
import { TaskAnalysisPage } from "./TaskAnalysisPage";
import {
  ANALYSIS_TAB_LABEL,
  navigateToCreateWithSource,
  resolveCompletedBarAction,
  resolveCompletedPrimaryAction,
  sourceTabLabel,
  taskResultTabs,
  type TaskResultTab,
} from "./task-page-model";

export interface TaskCompletedChrome {
  readonly headerAction?: ReactNode;
  readonly contextualAction?: ReactNode;
}

export interface TaskDetailPageProps {
  readonly runtime: AppRuntime;
  readonly detail: TaskDetailRecord;
  readonly record?: ContentAnalysisRecord;
  readonly navigate: Navigate;
  readonly readIssue?: TaskIssue;
  readonly issue?: TaskIssue;
  readonly streamProgress?: StructuredGenerationProgressV1;
  readonly onReload: () => void;
  readonly activeTab: TaskResultTab;
  readonly onSelectTab: (tab: TaskResultTab) => void;
  readonly onChromeChange: (chrome: TaskCompletedChrome) => void;
}

function hasPersistedPartial(detail: TaskDetailRecord): boolean {
  return detail.media.length > 0
    || Boolean(detail.transcript && (detail.transcript.text || detail.transcript.segments.length > 0))
    || Boolean(detail.imageText && (detail.imageText.text || detail.imageText.paragraphs.length > 0))
    || Boolean(detail.content.title || detail.content.description);
}

function scrollToPersistedPartial(detail: TaskDetailRecord): void {
  if (typeof document === "undefined") return;
  const target = detail.media.length > 0 ? "task-detail-media"
    : detail.transcript && (detail.transcript.text || detail.transcript.segments.length > 0) ? "task-detail-transcript"
    : detail.imageText && (detail.imageText.text || detail.imageText.paragraphs.length > 0) ? "task-detail-image-text"
    : (detail.content.title || detail.content.description) ? "task-detail-summary"
    : undefined;
  if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
}

function uniqueMedia(media: readonly MediaReference[]): readonly MediaReference[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    if (seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
}

const ENGAGEMENT_FIELDS = [
  { key: "likeCount", label: "点赞", icon: "heart" },
  { key: "favoriteCount", label: "收藏", icon: "bookmark" },
  { key: "commentCount", label: "评论", icon: "comment" },
  { key: "shareCount", label: "分享", icon: "share" },
  { key: "playCount", label: "播放", icon: "play" },
] as const;

function formatEngagementCount(value: number | undefined): string {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "未解析到";
}

export function TaskDetailPage({
  runtime,
  detail,
  record,
  navigate,
  readIssue,
  issue,
  streamProgress,
  onReload,
  activeTab,
  onSelectTab,
  onChromeChange,
}: TaskDetailPageProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"analysis" | "delete" | "template">();
  const [localIssue, setLocalIssue] = useState<TaskIssue>();

  const runAnalysis = async () => {
    setPendingAction("analysis");
    setLocalIssue(undefined);
    try {
      await runtime.analysis.run(detail.task.id);
    } catch (error) {
      setLocalIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "内容拆解无法开始", action: "none" }));
    } finally {
      setPendingAction(undefined);
      setConfirmationOpen(false);
    }
  };

  const deleteTask = async () => {
    setPendingAction("delete");
    setLocalIssue(undefined);
    try {
      await runtime.tasks.delete(detail.task.id);
      navigate(pathForRoute("home"));
    } catch (error) {
      setLocalIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "任务和视频没有删除完成", action: "retry" }));
    } finally {
      setPendingAction(undefined);
      setDeleteConfirmationOpen(false);
    }
  };

  const saveAsTemplate = async () => {
    setPendingAction("template");
    setLocalIssue(undefined);
    try {
      await runtime.templates.createFromAnalysis(detail.task.id);
      navigate(pathForRoute("templates"));
    } catch (error) {
      setLocalIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "拆解模板没有保存成功", action: "retry" }));
    } finally {
      setPendingAction(undefined);
    }
  };

  const imageMedia = useMemo(() => uniqueMedia([
    ...detail.media.filter((item) => item.kind === "image"),
    ...(detail.content.cover ? [detail.content.cover] : []),
  ]), [detail]);
  const video = detail.media.find((item) => item.kind === "video");
  const audio = detail.media.find((item) => item.kind === "audio");
  const cover = detail.content.cover;
  const task = detail.task;
  const localVideo = task.sourceKind === "local_video";
  const platform = localVideo ? "本地上传" : platformLabel(task.platform);
  const contentType = contentTypeLabel(task.contentType);
  const activeIssue = readIssue ?? localIssue ?? issue ?? task.issues[task.issues.length - 1];
  const needsNewSubmission = task.status === "failed" || task.status === "interrupted" || task.status === "cancelled";
  const hasEvidence = detail.evidenceUnits.length > 0;
  const terminalTask = task.status !== "queued" && task.status !== "running";
  const analysisAvailable = runtime.features.contentAnalysis === "available";
  const sourceLabel = sourceTabLabel(task.contentType);
  const tabs = taskResultTabs(task.contentType);
  const activeLabel = activeTab === "analysis" ? ANALYSIS_TAB_LABEL : sourceLabel;
  const tabGroupId = "task-result-tabs";
  const primary = resolveCompletedPrimaryAction({
    analysisStatus: task.analysisStatus,
    analysisAvailable,
    hasEvidence,
  });
  const canRerun = analysisAvailable && hasEvidence && (task.analysisStatus === "succeeded" || task.analysisStatus === "failed");
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    ...(hasPersistedPartial(detail) ? { partialResult: () => scrollToPersistedPartial(detail) } : {}),
  };
  const validatedDocument = record?.result?.schemaVersion === "content-analysis.v1";
  const orientation = mediaOrientationLabel(video ?? cover);
  const metaBits = [
    platform,
    detail.content.durationSeconds === undefined ? undefined : `${detail.content.durationSeconds} 秒`,
    orientation,
  ].filter(Boolean);

  const requestAnalysis = () => {
    onSelectTab("analysis");
    setDeleteConfirmationOpen(false);
    setConfirmationOpen(true);
  };

  const moreActions: readonly TaskMoreActionItem[] = [
    ...(task.analysisStatus === "succeeded" && runtime.features.templates === "available"
      ? [{
        id: "template",
        title: "存为模板",
        description: "保存结构公式，随时复用",
        icon: "bookmark" as const,
        onSelect: () => { void saveAsTemplate(); },
      }]
      : []),
    ...(task.analysisStatus === "succeeded"
      ? [{
        id: "replica",
        title: "按清单复刻",
        description: "逐镜拍摄或绑定素材",
        icon: "list_checks" as const,
        onSelect: () => navigate(replicaWizardPath(task.id)),
      }]
      : []),
    ...(canRerun
      ? [{
        id: "rerun",
        title: "重新拆解",
        description: "用同一份证据重新生成拆解",
        icon: "sync" as const,
        onSelect: requestAnalysis,
      }]
      : []),
    ...(terminalTask
      ? [{
        id: "delete",
        title: "删除",
        description: localVideo ? "永久删除本机任务和上传视频" : "永久删除本机任务及全部产物",
        icon: "error" as const,
        onSelect: () => { setConfirmationOpen(false); setDeleteConfirmationOpen(true); },
      }]
      : []),
  ];

  useEffect(() => {
    const headerAction = moreActions.length > 0
      ? (
        <button
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          aria-label="更多操作"
          className="icon-button"
          disabled={pendingAction !== undefined}
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <Icon name="more_horiz" size={20} />
        </button>
      )
      : undefined;
    const barAction = resolveCompletedBarAction({
      primary,
      confirmationOpen,
      deleteConfirmationOpen,
    });
    const contextualAction = barAction === "confirm-analysis"
      ? <Button className={pendingAction === "analysis" ? "is-busy" : ""} disabled={pendingAction === "analysis"} icon={<Icon name="auto_awesome" size={18} />} onClick={() => void runAnalysis()} size="lg">{pendingAction === "analysis" ? "AI 正在生成完整拆解" : "开始拆解"}</Button>
      : barAction === "start-analysis"
        ? <Button disabled={pendingAction !== undefined} icon={<Icon name="auto_awesome" size={18} />} onClick={requestAnalysis} size="lg">开始 AI 拆解</Button>
        : barAction === "next-steps"
          ? <Button disabled={pendingAction !== undefined} icon={<Icon name="movie_edit" size={17} />} onClick={() => navigateToCreateWithSource(navigate, task.id)} size="lg">用它做视频</Button>
          : undefined;
    onChromeChange({ headerAction, contextualAction });
  }, [confirmationOpen, deleteConfirmationOpen, moreActions.length, moreOpen, onChromeChange, pendingAction, primary, runtime.features.templates, task.id]);

  return (
    <>
      <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />
      {activeIssue ? <IssueNotice actions={issueActions} issue={activeIssue} /> : null}

      <section className="task-detail-hero" id="task-detail-media">
        {task.contentType === "image_text" ? (
          imageMedia.length === 0 ? <EmptyState description="任务没有可展示的已保存图片。" icon="folder_open" title="暂无图片" /> : <div className="runtime-image-gallery">{imageMedia.map((media) => <RuntimeMediaFrame className="runtime-image-gallery__item" key={media.uri} label={media.displayName ?? "已保存图片"} media={media} />)}</div>
        ) : video ? <RuntimeMediaFrame className="runtime-video-frame" label={detail.content.title ?? "已保存视频"} media={video} /> : cover ? <RuntimeMediaFrame className="runtime-video-frame" label={detail.content.title ?? "已保存封面"} media={cover} /> : <EmptyState description="任务没有可展示的已保存视频或封面。" icon="folder_open" title="暂无媒体" />}
        {audio ? <RuntimeMediaFrame className="runtime-audio-frame" label={audio.displayName ?? "已保存音频"} media={audio} /> : null}
      </section>

      <GlassCard className="task-detail-summary" id="task-detail-summary">
        <div className="task-detail-summary__heading">
          <div>
            <h2>{detail.content.title ?? (localVideo ? "本地上传视频" : "未提供标题")}</h2>
            {metaBits.length > 0 ? <p>{metaBits.join(" · ")}</p> : null}
          </div>
          <TaskStatusBadge status={task.status} />
        </div>
        <p className="technical-value">{localVideo ? "本地上传 · 私有任务文件" : safeUrlForDisplay(detail.content.canonicalUrl ?? task.sourceUrl)}</p>
        <div className="task-detail-summary__facts">
          {contentType ? <span><Icon name={task.contentType === "image_text" ? "grid" : "video_file" } size={15} />{contentType}</span> : null}
          {detail.content.author ? <span><Icon name="face" size={15} />{detail.content.author}</span> : null}
          {formatTaskTime(task.updatedAt) ? <span><Icon name="history" size={15} />{formatTaskTime(task.updatedAt)}</span> : null}
          {validatedDocument ? <span><Icon name="check_circle" size={15} />本地保存 · 已校验 content-analysis.v1</span> : null}
          <span><Icon name="folder" size={15} />本地占用 {formatStoredSize(totalMediaByteLength(detail.media))}</span>
        </div>
        {detail.content.description ? <div className="task-detail-summary__description">{detail.content.description}</div> : null}
      </GlassCard>

      <section aria-label="互动数据" className="task-detail-engagement">
        {ENGAGEMENT_FIELDS.map((field) => (
          <div className="task-detail-engagement__item" key={field.key}>
            <Icon name={field.icon} size={15} />
            <span>{field.label}</span>
            <strong>{formatEngagementCount(detail.content[field.key])}</strong>
          </div>
        ))}
      </section>

      <section className="page-section task-result-tabs">
        <Tabs active={activeLabel} ariaLabel="原文与拆解" id={tabGroupId} onSelect={(tab) => onSelectTab(tab === ANALYSIS_TAB_LABEL ? "analysis" : "source")} tabs={tabs} variant="segmented" />
        <TabPanel className="task-result-tabs__panel" id={tabPanelId(tabGroupId)} labelledBy={tabId(tabGroupId, activeTab === "analysis" ? 1 : 0)} slideKey={activeLabel} tabs={tabs}>
          {activeTab === "source" ? (
            task.contentType === "image_text" ? (
              <div id="task-detail-image-text">
                <div className="section-heading"><h3>图文正文</h3><span className="analysis-count">{detail.imageText?.paragraphs.length ?? 0} 段</span></div>
                {detail.imageText?.text || detail.imageText?.paragraphs.length ? <GlassCard className="runtime-transcript-card"><p className="runtime-transcript-card__full">{detail.imageText?.text}</p>{detail.imageText?.paragraphs.length ? <ol>{detail.imageText.paragraphs.map((paragraph) => <li key={paragraph.id}><p>{paragraph.text}</p></li>)}</ol> : null}</GlassCard> : <EmptyState description="任务没有保存可展示的图文正文。" icon="file" title="暂无正文" />}
              </div>
            ) : (
              <div id="task-detail-transcript">
                <div className="section-heading"><h3>原始文稿</h3>{task.speechStatus ? <span className="analysis-count">{task.speechStatus === "transcribed" ? "已转写" : task.speechStatus === "no_speech" ? "未检测到口播" : "转写未完成"}</span> : null}</div>
                {task.speechStatus === "no_speech" ? <EmptyState description="本次媒体没有检测到有效口播。这是正常结果，不会用平台描述伪装成语音转写。" icon="voice" title="未检测到有效口播" /> : detail.transcript && (detail.transcript.text || detail.transcript.segments.length > 0) ? (
                  <GlassCard className="runtime-transcript-card">
                    {detail.transcript.text ? <p className="runtime-transcript-card__full">{detail.transcript.text}</p> : null}
                    {detail.transcript.segments.length > 0 ? <ol>{detail.transcript.segments.map((segment) => <li key={segment.id}><time>{segment.startSeconds === undefined ? "" : `${segment.startSeconds}s`}</time><p>{segment.text}</p></li>)}</ol> : null}
                  </GlassCard>
                ) : <EmptyState description={task.speechStatus === "failed" ? "文稿处理未完成，未找到可安全展示的部分文稿。" : "任务尚未保存可展示的文稿。"} icon="record_voice_over" title="暂无文稿" />}
              </div>
            )
          ) : (
            <TaskAnalysisPage
              contentAnalysisCapability={runtime.features.contentAnalysis}
              detail={detail}
              issue={issue ?? localIssue}
              navigate={navigate}
              onReload={onReload}
              progress={streamProgress}
              readIssue={readIssue}
              record={record}
            />
          )}
        </TabPanel>
      </section>

      {confirmationOpen ? <GlassCard className="analysis-confirm-card"><strong>开始 AI 内容拆解？</strong><p>AI 将根据已经获取的 {detail.evidenceUnits.length} 段内容，整理主题、结构和创作方法。</p><div className="analysis-confirm-card__actions mobile-action-group"><Button disabled={pendingAction === "analysis"} onClick={() => setConfirmationOpen(false)} variant="quiet">暂不运行</Button></div></GlassCard> : null}
      {activeTab !== "analysis" && (pendingAction === "analysis" || streamProgress || task.analysisStatus === "running") ? <ValidatedModuleProgress definitions={contentAnalysisModuleDefinitions} failedTitle="内容拆解未完成" issue={localIssue ?? issue} progress={streamProgress} title="AI 正在整理内容" /> : null}

      {needsNewSubmission ? <GlassCard className="analysis-request-card"><Icon name="sync" size={22} /><p>本版本不会继续或复制旧任务。若需再次处理，请返回首页重新提交链接。</p><Button icon={<Icon name="arrow_back" size={18} />} onClick={() => navigate(pathForRoute("home"))} variant="secondary">重新提交链接</Button></GlassCard> : null}
      {deleteConfirmationOpen ? (
        <ConfirmDeleteSheet
          busy={pendingAction !== undefined}
          confirmLabel="确认删除"
          description="将永久删除本机任务目录中的媒体、文稿、拆解与事件，不可恢复；已经复制保存的模板不受影响。"
          heading={`确认删除这个任务${localVideo ? "及上传视频" : "及全部产物"}？`}
          onClose={() => setDeleteConfirmationOpen(false)}
          onConfirm={() => void deleteTask()}
          open
          title="删除任务"
        />
      ) : null}
      {readIssue ? <Button icon={<Icon name="update" size={18} />} onClick={() => void onReload()} variant="quiet">重新读取任务详情</Button> : null}

      <TaskMoreActionsSheet items={moreActions} onClose={() => setMoreOpen(false)} open={moreOpen} />
    </>
  );
}
