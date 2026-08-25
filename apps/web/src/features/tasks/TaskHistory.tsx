import { useState } from "react";
import { isTerminalTaskStatus, issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, TaskIssue } from "@hongtai/core";

import { Icon } from "../../components/Icon";
import { RecentRecordActionsSheet } from "../../components/RecentRecordActionsSheet";
import { EmptyState } from "../../components/StatePanels";
import { TaskStatusBadge } from "../../components/TaskStatusBadge";
import { useLongPress } from "../../hooks/useLongPress";
import { taskDetailPath, type Navigate } from "../../router";
import { formatTaskTime, platformLabel } from "./task-presenters";

function taskHistoryLabel(task: AppTaskRecord): string {
  return task.sourceKind === "local_video" ? "我上传的视频" : safeUrlForDisplay(task.sourceUrl);
}

function TaskHistoryItem({ task, navigate, onLongPress }: { readonly task: AppTaskRecord; readonly navigate: Navigate; readonly onLongPress: () => void }) {
  const localVideo = task.sourceKind === "local_video";
  const platform = localVideo ? "本地上传" : platformLabel(task.platform);
  const updatedAt = formatTaskTime(task.updatedAt);
  const longPress = useLongPress({ onClick: () => navigate(taskDetailPath(task.id)), onLongPress });

  return (
    <button aria-label={`${taskHistoryLabel(task)}，长按管理记录`} className="runtime-task-history__item" {...longPress} type="button">
      <span className="runtime-task-history__icon"><Icon name={task.contentType === "image_text" ? "grid" : "video_file"} size={19} /></span>
      <span className="runtime-task-history__body">
        <strong className={localVideo ? undefined : "technical-value"}>{taskHistoryLabel(task)}</strong>
        <span>{[platform, updatedAt].filter(Boolean).join(" · ") || `任务 ${task.id}`}</span>
      </span>
      <TaskStatusBadge compact status={task.status} />
      <Icon className="runtime-task-history__chevron" name="chevron_right" size={18} />
    </button>
  );
}

export interface TaskHistoryProps {
  readonly runtime: AppRuntime;
  readonly tasks: readonly AppTaskRecord[];
  readonly navigate: Navigate;
  readonly onDeleted?: (taskId: string) => void;
}

export function TaskHistory({ runtime, tasks, navigate, onDeleted }: TaskHistoryProps) {
  const [selectedTask, setSelectedTask] = useState<AppTaskRecord>();
  const [deleting, setDeleting] = useState(false);
  const [deleteIssue, setDeleteIssue] = useState<TaskIssue>();

  if (tasks.length === 0) {
    return <EmptyState description="完成一次真实采集后，任务会保存在这里。" icon="history" title="还没有本地任务" />;
  }

  const closeActions = () => {
    setSelectedTask(undefined);
    setDeleteIssue(undefined);
  };

  const deleteSelected = async () => {
    if (!selectedTask || !isTerminalTaskStatus(selectedTask.status) || deleting) return;
    setDeleting(true);
    setDeleteIssue(undefined);
    try {
      await runtime.tasks.delete(selectedTask.id);
      onDeleted?.(selectedTask.id);
      closeActions();
    } catch (error) {
      setDeleteIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法删除本地拆解记录", action: "free_storage" }));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="runtime-task-history">
        {tasks.map((task) => (
          <TaskHistoryItem key={task.id} navigate={navigate} onLongPress={() => { setDeleteIssue(undefined); setSelectedTask(task); }} task={task} />
        ))}
      </div>
      {selectedTask ? (
        <RecentRecordActionsSheet
          canDelete={isTerminalTaskStatus(selectedTask.status)}
          deleting={deleting}
          deleteDisabledReason="进行中的拆解不能删除，等待它进入明确终态后再试。"
          issue={deleteIssue}
          kind="task"
          onClose={closeActions}
          onDelete={() => void deleteSelected()}
          open
          recordLabel={taskHistoryLabel(selectedTask)}
        />
      ) : null}
    </>
  );
}
