import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, InputInspection, StructuredGenerationProgressV1, TaskChangeEventV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { ErrorState, LoadingState, EmptyState } from "../components/StatePanels";
import { TabPanel, Tabs, tabId, tabPanelId } from "../components/Tabs";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { LiveListReadReconciler } from "../features/generation/live-list-read-reconciler";
import { contentAnalysisModuleDefinitions } from "../features/tasks/content-analysis-module-progress";
import { formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, taskDetailPath, type Navigate } from "../router";

const SOURCE_TABS = ["粘贴链接", "上传视频"] as const;
const SOURCE_TAB_GROUP_ID = "task-source-tabs";

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

function focusTaskShareInput(): void {
  if (typeof document !== "undefined") document.getElementById("task-share-input")?.focus();
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
          <button className="runtime-task-history__item" key={task.id} onClick={() => navigate(taskDetailPath(task.id))} type="button">
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
  const [sourceTab, setSourceTab] = useState<(typeof SOURCE_TABS)[number]>("粘贴链接");
  const [input, setInput] = useState("");
  const [inspection, setInspection] = useState<InputInspection>();
  const [tasks, setTasks] = useState<readonly AppTaskRecord[]>();
  const [historyIssue, setHistoryIssue] = useState<TaskIssue>();
  const [submitIssue, setSubmitIssue] = useState<TaskIssue>();
  const [submitting, setSubmitting] = useState(false);
  const [videoImporting, setVideoImporting] = useState(false);
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
          setVideoImporting(true);
          setSourceTab("上传视频");
          if (event.type === "progress") setVideoProgress(event.progress);
          if (event.type === "failed") {
            setVideoProgress(event.progress);
            setSubmitIssue(event.issue);
          }
        });
        if (!active) return;
        if (recovered.status === "succeeded") navigate(taskDetailPath(recovered.record.taskId));
        if (recovered.status === "failed") {
          setSourceTab("上传视频");
          setSubmitIssue(recovered.issue);
        }
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

  const pasteShareInput = async () => {
    if (submitting || videoImporting) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) updateInput(text);
      else focusTaskShareInput();
    } catch {
      focusTaskShareInput();
    }
  };

  const submit = async () => {
    if (!ingestAvailable || !inspection?.ok || submitting || videoImporting) return;
    setSubmitting(true);
    setSubmitIssue(undefined);
    try {
      const result = await submitLocalTask(runtime.tasks, input);
      if (result.status === "started") {
        navigate(taskDetailPath(result.task.id));
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
    setSourceTab("上传视频");
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
      navigate(taskDetailPath(record.taskId));
    } catch (error) {
      setSubmitIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "本地视频没有完成自动拆解", action: "select_media" }));
    } finally {
      setVideoImporting(false);
    }
  };

  const sourceBusy = submitting || videoImporting;
  const linkTab = sourceTab === "粘贴链接";
  const contextualAction = linkTab
    ? (
      <Button className={submitting ? "is-busy" : ""} disabled={!ingestAvailable || !inspection?.ok || submitting || videoImporting} icon={<Icon name={submitting ? "sync" : "bolt"} size={19} />} onClick={() => void submit()} size="lg">
        {submitting ? "正在创建本地任务" : "开始拆解"}
      </Button>
    )
    : (
      <Button className={videoImporting ? "is-busy" : ""} disabled={!ingestAvailable || runtime.features.contentAnalysis !== "available" || submitting || videoImporting} icon={<Icon name={videoImporting ? "sync" : "upload_file"} size={19} />} onClick={() => void importVideo()} size="lg">
        {videoImporting ? "正在识别视频内容" : "选择视频并拆解"}
      </Button>
    );

  return (
    <AppShell activeNav="home" contextualAction={contextualAction} navigate={navigate} title="宏泰AI智能体">
      <div className="page-stack page-task-home">
        <section className="task-page-heading">
          <h2>今天想拆解哪条爆款？</h2>
          <p>让 AI 助你洞察爆款逻辑</p>
        </section>

        <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />

        <GlassCard className="task-source-card">
          <Tabs
            active={sourceTab}
            ariaLabel="拆解来源"
            id={SOURCE_TAB_GROUP_ID}
            onSelect={(tab) => {
              if (sourceBusy) return;
              if (tab === "粘贴链接" || tab === "上传视频") setSourceTab(tab);
            }}
            tabs={SOURCE_TABS}
          />
          <TabPanel className="task-source-card__panel" id={tabPanelId(SOURCE_TAB_GROUP_ID)} labelledBy={tabId(SOURCE_TAB_GROUP_ID, linkTab ? 0 : 1)}>
            {linkTab ? (
              <>
                <label className="field-label" htmlFor="task-share-input"><Icon name="link" size={20} />作品链接</label>
                <div className="input-card__control">
                  <input
                    aria-describedby="task-share-hint"
                    disabled={sourceBusy}
                    id="task-share-input"
                    onChange={(event) => updateInput(event.target.value)}
                    placeholder="可直接粘贴平台分享文字，应用会从中提取第一个受支持链接"
                    type="text"
                    value={input}
                  />
                  <button aria-label="粘贴" className="input-card__paste" disabled={sourceBusy} onClick={() => void pasteShareInput()} type="button">
                    <Icon name="content_paste" size={18} />
                  </button>
                </div>
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
                ) : inspection ? <IssueNotice actions={{ editInput: focusTaskShareInput }} issue={inspection.issue} /> : null}
              </>
            ) : (
              <>
                <div className="task-source-card__upload">
                  <strong>上传本地视频</strong>
                  <p>请选择一段带有清晰人声的 MP4 视频，应用会先识别口播内容，再生成拆解结果。</p>
                  <small>单个 MP4，最大 250MB。视频只保存在本机。</small>
                </div>
                {videoImporting || videoProgress ? <ValidatedModuleProgress definitions={contentAnalysisModuleDefinitions} failedTitle="这次拆解没有完成" issue={submitIssue} progress={videoProgress} title="正在整理视频内容" /> : null}
              </>
            )}
            {submitIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), editInput: focusTaskShareInput }} issue={submitIssue} /> : null}
          </TabPanel>
        </GlassCard>

        <section className="page-section">
          <div className="section-heading"><h3>最近拆解</h3>{historyIssue ? <Button onClick={() => void loadHistory()} variant="quiet">重新读取</Button> : null}</div>
          {historyIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), editInput: focusTaskShareInput }} issue={historyIssue} /> : null}
          {historyIssue && tasks === undefined ? <ErrorState description={historyIssue.userMessage} title="任务历史无法读取" /> : tasks === undefined ? <LoadingState description="正在从本地仓储读取任务记录" title="读取任务历史" /> : <TaskHistory navigate={navigate} tasks={tasks} />}
        </section>
      </div>
    </AppShell>
  );
}
