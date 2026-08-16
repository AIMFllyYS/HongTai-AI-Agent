import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, InputInspection, StructuredGenerationProgressV1, TaskChangeEventV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { ErrorState, LoadingState, EmptyState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { LiveListReadReconciler } from "../features/generation/live-list-read-reconciler";
import { contentAnalysisModuleDefinitions } from "../features/tasks/content-analysis-module-progress";
import { formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, taskAnalysisPath, taskDetailPath, taskProcessingPath, type Navigate } from "../router";

export interface TaskHomePageProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

interface TaskSubmissionPort {
  create(input: { readonly input: string }): Promise<AppTaskRecord>;
  start(taskId: string): Promise<unknown>;
}

export type TaskSubmissionResult =
  | { readonly status: "started"; readonly task: AppTaskRecord }
  | { readonly status: "create_failed"; readonly issue: TaskIssue }
  | { readonly status: "start_failed"; readonly task: AppTaskRecord; readonly issue: TaskIssue };

export async function submitLocalTask(tasks: TaskSubmissionPort, input: string): Promise<TaskSubmissionResult> {
  let task: AppTaskRecord;
  try {
    task = await tasks.create({ input });
  } catch (error) {
    return {
      status: "create_failed",
      issue: issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法保存本地采集任务", action: "free_storage" }),
    };
  }

  try {
    await tasks.start(task.id);
    return { status: "started", task };
  } catch (error) {
    return {
      status: "start_failed",
      task,
      issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "本地采集任务无法启动", action: "retry" }),
    };
  }
}

function taskPath(task: AppTaskRecord): string {
  return task.status === "queued" || task.status === "running"
    ? taskProcessingPath(task.id)
    : taskDetailPath(task.id);
}

export function applyTaskHistoryChange(
  current: readonly AppTaskRecord[] | undefined,
  event: TaskChangeEventV1,
  limit = 12,
): readonly AppTaskRecord[] {
  if (event.type === "deleted") return (current ?? []).filter((task) => task.id !== event.taskId);
  const byId = new Map((current ?? []).map((task) => [task.id, task]));
  byId.set(event.task.id, event.task);
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit);
}

function inspectionFor(runtime: AppRuntime, input: string): InputInspection | undefined {
  if (!input.trim()) return undefined;
  try {
    return runtime.tasks.inspectInput(input);
  } catch (error) {
    return { ok: false, issue: issueFromAppError(error, { code: "INPUT_URL_INVALID", message: "无法识别分享内容", action: "edit_input" }) };
  }
}

function TaskHistory({ tasks, navigate }: { readonly tasks: readonly AppTaskRecord[]; readonly navigate: Navigate }) {
  if (tasks.length === 0) {
    return <EmptyState description="完成一次真实采集后，任务会保存在本机并显示在这里。" icon="history" title="还没有本地任务" />;
  }
  return (
    <div className="runtime-task-history">
      {tasks.map((task) => {
        const localVideo = task.sourceKind === "local_video";
        const platform = localVideo ? "本地上传" : platformLabel(task.platform);
        const updatedAt = formatTaskTime(task.updatedAt);
        return (
          <button className="runtime-task-history__item" key={task.id} onClick={() => navigate(taskPath(task))} type="button">
            <span className="runtime-task-history__icon"><Icon name={task.contentType === "image_text" ? "grid" : "video_file"} size={19} /></span>
            <span className="runtime-task-history__body">
              <strong className={localVideo ? undefined : "technical-value"}>{localVideo ? "我上传的视频" : safeUrlForDisplay(task.sourceUrl)}</strong>
              <span>{[platform, updatedAt].filter(Boolean).join(" · ") || `任务 ${task.id}`}</span>
            </span>
            <TaskStatusBadge compact status={task.status} />
            <Icon className="runtime-task-history__chevron" name="chevron_right" size={18} />
          </button>
        );
      })}
    </div>
  );
}

export function TaskHomePage({ runtime, navigate }: TaskHomePageProps) {
  const ingestAvailable = runtime.features.ingest === "available";
  const taskHistoryReads = useRef(new LiveListReadReconciler<TaskChangeEventV1>());
  const [input, setInput] = useState("");
  const [inspection, setInspection] = useState<InputInspection>();
  const [tasks, setTasks] = useState<readonly AppTaskRecord[]>();
  const [historyIssue, setHistoryIssue] = useState<TaskIssue>();
  const [submitIssue, setSubmitIssue] = useState<TaskIssue>();
  const [submitting, setSubmitting] = useState(false);
  const [videoImporting, setVideoImporting] = useState(true);
  const [videoProgress, setVideoProgress] = useState<StructuredGenerationProgressV1>();

  const loadHistory = useCallback(async () => {
    const read = taskHistoryReads.current.beginRead();
    try {
      setHistoryIssue(undefined);
      const loaded = await runtime.tasks.list({ limit: 12 });
      const reconciled = taskHistoryReads.current.reconcile(
        read,
        loaded,
        (current, event) => applyTaskHistoryChange(current, event),
      );
      if (reconciled === undefined) return;
      setTasks(reconciled);
    } catch (error) {
      if (!taskHistoryReads.current.abandon(read)) return;
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地任务历史暂时无法读取", action: "none" }));
    }
  }, [runtime]);

  useAppResume(loadHistory);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    const consumeRecovery = async () => {
      try {
        const recovered = await runtime.analysis.consumeVideoRecovery((event) => {
          if (!active) return;
          if (event.type === "progress") setVideoProgress(event.progress);
          if (event.type === "failed") {
            setVideoProgress(event.progress);
            setSubmitIssue(event.issue);
          }
        });
        if (!active) return;
        if (recovered.status === "succeeded") navigate(taskAnalysisPath(recovered.record.taskId));
        if (recovered.status === "failed") setSubmitIssue(recovered.issue);
      } catch (error) {
        if (active) {
          setSubmitIssue(issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "视频选择恢复失败，请重新选择", action: "select_media" }));
        }
      } finally {
        if (active) setVideoImporting(false);
      }
    };
    void consumeRecovery();
    return () => { active = false; };
  }, [navigate, runtime]);

  useEffect(() => {
    try {
      return runtime.tasks.subscribeChanges((event) => {
        taskHistoryReads.current.record(event);
        setTasks((current) => applyTaskHistoryChange(current, event));
        setHistoryIssue(undefined);
      });
    } catch (error) {
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地任务自动更新暂时不可用", action: "none" }));
      return undefined;
    }
  }, [runtime]);

  const updateInput = (next: string) => {
    setInput(next);
    setSubmitIssue(undefined);
    setInspection(inspectionFor(runtime, next));
  };

  const submit = async () => {
    if (!ingestAvailable || !inspection?.ok || submitting || videoImporting) return;
    setSubmitting(true);
    setSubmitIssue(undefined);
    try {
      const result = await submitLocalTask(runtime.tasks, input);
      if (result.status === "started") {
        navigate(taskProcessingPath(result.task.id));
      } else {
        setSubmitIssue(result.issue);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const importVideo = async () => {
    if (!ingestAvailable || runtime.features.contentAnalysis !== "available" || submitting || videoImporting) return;
    setVideoImporting(true);
    setSubmitIssue(undefined);
    setVideoProgress(undefined);
    try {
      const record = await runtime.analysis.importVideo((event) => {
        if (event.type === "progress") setVideoProgress(event.progress);
        if (event.type === "failed") {
          setVideoProgress(event.progress);
          setSubmitIssue(event.issue);
        }
      });
      navigate(taskAnalysisPath(record.taskId));
    } catch (error) {
      setSubmitIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "本地视频没有完成自动拆解", action: "select_media" }));
    } finally {
      setVideoImporting(false);
    }
  };

  return (
    <AppShell activeNav="home" navigate={navigate} title="宏泰AI智能体">
      <div className="page-stack page-task-home">
        <section className="task-page-heading">
          <span className="eyebrow">内容拆解</span>
          <h2>粘贴作品链接，或上传自己的视频</h2>
          <p>应用会提取作品内容，帮你梳理主题、开场方式、内容结构和可复用的创作思路。</p>
        </section>

        <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />

        <GlassCard className="task-local-upload-card">
          <span className="task-source-index">01</span>
          <div><strong>上传视频并开始拆解</strong><p>请选择一段带有清晰人声的 MP4 视频，应用会先识别口播内容，再生成拆解结果。</p><small>单个 MP4，最大 250MB。视频只保存在本机。</small></div>
          <Button className={videoImporting ? "is-busy" : ""} disabled={!ingestAvailable || runtime.features.contentAnalysis !== "available" || submitting || videoImporting} icon={<Icon name={videoImporting ? "sync" : "upload_file"} size={19} />} onClick={() => void importVideo()} size="lg">
            {videoImporting ? "正在识别视频内容" : "选择本地视频"}
          </Button>
          {videoImporting || videoProgress ? <ValidatedModuleProgress definitions={contentAnalysisModuleDefinitions} failedTitle="这次拆解没有完成" issue={submitIssue} progress={videoProgress} title="正在整理视频内容" /> : null}
        </GlassCard>

        <GlassCard className="task-input-card">
          <span className="task-source-index">02</span>
          <label className="field-label" htmlFor="task-share-input"><Icon name="link" size={20} />分享文案或作品链接</label>
          <textarea
            aria-describedby="task-share-hint"
            disabled={submitting || videoImporting}
            id="task-share-input"
            onChange={(event) => updateInput(event.target.value)}
            placeholder="可直接粘贴平台分享文字，应用会从中提取第一个受支持链接"
            rows={5}
            value={input}
          />
          <p className="field-hint" id="task-share-hint"><Icon name="info" size={16} />支持抖音、小红书、B站；快手仅支持公开单条链接并会标记为实验性。</p>

          {inspection?.ok ? (
            <div className="task-input-inspection" data-platform={inspection.value.platform}>
              <Icon name="check_circle" size={18} />
              <div>
                <strong>已识别 {platformLabel(inspection.value.platform)}</strong>
                <span className="technical-value">{safeUrlForDisplay(inspection.value.normalizedUrl)}</span>
                {inspection.value.ignoredSupportedUrlCount > 0 ? <small>其余 {inspection.value.ignoredSupportedUrlCount} 个受支持链接未被选作本次任务。</small> : null}
                {inspection.value.platform === "kuaishou" ? <small>快手为实验性支持，平台风控结果会如实记录。</small> : null}
              </div>
            </div>
          ) : inspection ? <IssueNotice issue={inspection.issue} /> : null}
          {submitIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()) }} issue={submitIssue} /> : null}

          <Button className={`task-input-card__submit ${submitting ? "is-busy" : ""}`.trim()} disabled={!ingestAvailable || !inspection?.ok || submitting || videoImporting} icon={<Icon name={submitting ? "sync" : "bolt"} size={19} />} onClick={() => void submit()} size="lg">
            {submitting ? "正在创建本地任务" : "开始采集"}
          </Button>
        </GlassCard>

        <section className="page-section">
          <div className="section-heading"><h3>本地任务历史</h3>{historyIssue ? <Button onClick={() => void loadHistory()} variant="quiet">重新读取</Button> : null}</div>
          {historyIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()) }} issue={historyIssue} /> : null}
          {historyIssue && tasks === undefined ? <ErrorState description={historyIssue.userMessage} title="任务历史无法读取" /> : tasks === undefined ? <LoadingState description="正在从本地仓储读取任务记录" title="读取任务历史" /> : <TaskHistory navigate={navigate} tasks={tasks} />}
        </section>
      </div>
    </AppShell>
  );
}
