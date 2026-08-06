import { useCallback, useEffect, useState } from "react";
import { issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, InputInspection, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { ErrorState, LoadingState, EmptyState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { TaskStatusBadge } from "../components/TaskStatusBadge";
import { formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
import { aiSettingsPath, taskDetailPath, taskProcessingPath, type Navigate } from "../router";

export interface TaskHomePageProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

function taskPath(task: AppTaskRecord): string {
  return task.status === "queued" || task.status === "running"
    ? taskProcessingPath(task.id)
    : taskDetailPath(task.id);
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
        const platform = platformLabel(task.platform);
        const updatedAt = formatTaskTime(task.updatedAt);
        return (
          <button className="runtime-task-history__item" key={task.id} onClick={() => navigate(taskPath(task))} type="button">
            <span className="runtime-task-history__icon"><Icon name={task.contentType === "image_text" ? "grid" : "video_file"} size={19} /></span>
            <span className="runtime-task-history__body">
              <strong>{safeUrlForDisplay(task.sourceUrl)}</strong>
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
  const [input, setInput] = useState("");
  const [inspection, setInspection] = useState<InputInspection>();
  const [tasks, setTasks] = useState<readonly AppTaskRecord[]>();
  const [historyIssue, setHistoryIssue] = useState<TaskIssue>();
  const [submitIssue, setSubmitIssue] = useState<TaskIssue>();
  const [submitting, setSubmitting] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryIssue(undefined);
      setTasks(await runtime.tasks.list({ limit: 12 }));
    } catch (error) {
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地任务历史暂时无法读取", action: "none" }));
    }
  }, [runtime]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const updateInput = (next: string) => {
    setInput(next);
    setSubmitIssue(undefined);
    setInspection(inspectionFor(runtime, next));
  };

  const submit = async () => {
    if (!ingestAvailable || !inspection?.ok || submitting) return;
    setSubmitting(true);
    setSubmitIssue(undefined);
    try {
      const task = await runtime.tasks.create({ input });
      await runtime.tasks.start(task.id);
      navigate(taskProcessingPath(task.id));
    } catch (error) {
      setSubmitIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "无法创建本地采集任务", action: "none" }));
      void loadHistory();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell activeNav="home" navigate={navigate} title="宏泰AI智能体">
      <div className="page-stack page-task-home">
        <section className="task-page-heading">
          <span className="eyebrow">LOCAL INGEST</span>
          <h2>从分享文案开始</h2>
          <p>粘贴含链接的完整分享内容。应用只会保存任务所需的安全链接，不会保存原始分享文本。</p>
        </section>

        <TaskCapabilityNotice capability={runtime.features.ingest} feature="ingest" />

        <GlassCard className="task-input-card">
          <label className="field-label" htmlFor="task-share-input"><Icon name="link" size={20} />分享文案或作品链接</label>
          <textarea
            aria-describedby="task-share-hint"
            disabled={submitting}
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
                <span>{safeUrlForDisplay(inspection.value.normalizedUrl)}</span>
                {inspection.value.ignoredSupportedUrlCount > 0 ? <small>其余 {inspection.value.ignoredSupportedUrlCount} 个受支持链接未被选作本次任务。</small> : null}
                {inspection.value.platform === "kuaishou" ? <small>快手为实验性支持，平台风控结果会如实记录。</small> : null}
              </div>
            </div>
          ) : inspection ? <IssueNotice issue={inspection.issue} /> : null}
          {submitIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()) }} issue={submitIssue} /> : null}

          <Button className="task-input-card__submit" disabled={!ingestAvailable || !inspection?.ok || submitting} icon={<Icon name={submitting ? "sync" : "bolt"} size={19} />} onClick={() => void submit()} size="lg">
            {submitting ? "正在创建本地任务" : "开始采集"}
          </Button>
        </GlassCard>

        <section className="page-section">
          <div className="section-heading"><h3>本地任务历史</h3><button className="text-action" onClick={() => void loadHistory()} type="button">刷新</button></div>
          {historyIssue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()) }} issue={historyIssue} /> : null}
          {historyIssue && tasks === undefined ? <ErrorState description={historyIssue.userMessage} title="任务历史无法读取" /> : tasks === undefined ? <LoadingState description="正在从本地仓储读取任务记录" title="读取任务历史" /> : <TaskHistory navigate={navigate} tasks={tasks} />}
        </section>
      </div>
    </AppShell>
  );
}
