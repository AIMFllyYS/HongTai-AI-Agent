import { useState } from "react";
import { isTerminalTaskStatus, issueFromAppError, safeUrlForDisplay } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ContentTemplateRecord, TaskIssue } from "@hongtai/core";

import { Icon } from "../../components/Icon";
import { RecentRecordActionsSheet, type RecentRecordDeleteOptions } from "../../components/RecentRecordActionsSheet";
import { RenameSheet } from "../../components/RenameSheet";
import { EmptyState } from "../../components/StatePanels";
import { TaskStatusBadge } from "../../components/TaskStatusBadge";
import { useLongPress } from "../../hooks/useLongPress";
import { taskDetailPath, type Navigate } from "../../router";
import { formatTaskTime, platformLabel } from "./task-presenters";

function taskHistoryLabel(task: AppTaskRecord, recordNames?: ReadonlyMap<string, string>): string {
  const named = recordNames?.get(task.id);
  if (named) return named;
  return task.sourceKind === "local_video" ? "我上传的视频" : safeUrlForDisplay(task.sourceUrl);
}

/** 只有最终回退到链接展示时才使用等宽 technical-value 样式。 */
function taskHistoryLabelIsUrl(task: AppTaskRecord, recordNames?: ReadonlyMap<string, string>): boolean {
  return !recordNames?.get(task.id) && task.sourceKind !== "local_video";
}

interface RenameTarget {
  readonly task: AppTaskRecord;
  readonly template: ContentTemplateRecord;
}

function TaskHistoryItem({ task, label, labelIsUrl, navigate, onLongPress }: { readonly task: AppTaskRecord; readonly label: string; readonly labelIsUrl: boolean; readonly navigate: Navigate; readonly onLongPress: () => void }) {
  const localVideo = task.sourceKind === "local_video";
  const platform = localVideo ? "本地上传" : platformLabel(task.platform);
  const updatedAt = formatTaskTime(task.updatedAt);
  const longPress = useLongPress({ onClick: () => navigate(taskDetailPath(task.id)), onLongPress });

  return (
    <button aria-label={`${label}，长按管理记录`} className="runtime-task-history__item" {...longPress} type="button">
      <span className="runtime-task-history__icon"><Icon name={task.contentType === "image_text" ? "grid" : "video_file"} size={19} /></span>
      <span className="runtime-task-history__body">
        <strong className={labelIsUrl ? "technical-value" : undefined}>{label}</strong>
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
  readonly recordNames?: ReadonlyMap<string, string>;
  readonly templatesByTask?: ReadonlyMap<string, ContentTemplateRecord>;
  readonly navigate: Navigate;
  readonly onDeleted?: (taskId: string) => void;
  /** 重命名等不动任务列表的联动变更完成后触发，父级据此刷新名称映射。 */
  readonly onRecordsChanged?: () => void;
}

export function TaskHistory({ runtime, tasks, recordNames, templatesByTask, navigate, onDeleted, onRecordsChanged }: TaskHistoryProps) {
  const [selectedTask, setSelectedTask] = useState<AppTaskRecord>();
  const [deleting, setDeleting] = useState(false);
  const [deleteIssue, setDeleteIssue] = useState<TaskIssue>();
  const [renameTarget, setRenameTarget] = useState<RenameTarget>();
  const [renaming, setRenaming] = useState(false);
  const [renameIssue, setRenameIssue] = useState<TaskIssue>();

  if (tasks.length === 0) {
    return <EmptyState description="完成一次真实采集后，任务会保存在这里。" icon="history" title="还没有本地任务" />;
  }

  const closeActions = () => {
    setSelectedTask(undefined);
    setDeleteIssue(undefined);
  };

  const closeRename = () => {
    setRenameTarget(undefined);
    setRenameIssue(undefined);
  };

  const deleteSelected = async (options: RecentRecordDeleteOptions) => {
    if (!selectedTask || !isTerminalTaskStatus(selectedTask.status) || deleting) return;
    setDeleting(true);
    setDeleteIssue(undefined);
    try {
      await runtime.tasks.delete(selectedTask.id, { keepLocalVideo: options.keepLocalVideo });
      onDeleted?.(selectedTask.id);
      closeActions();
    } catch (error) {
      setDeleteIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法删除本地拆解记录", action: "free_storage" }));
    } finally {
      setDeleting(false);
    }
  };

  const submitRename = async (name: string) => {
    if (!renameTarget || renaming) return;
    setRenaming(true);
    setRenameIssue(undefined);
    try {
      const { template } = renameTarget;
      await runtime.templates.update(template.templateId, {
        name,
        summary: template.summary,
        formula: template.formula,
        steps: template.steps,
        variableSlots: template.variableSlots,
      });
      closeRename();
      onRecordsChanged?.();
    } catch (error) {
      setRenameIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法保存模板名称", action: "retry" }));
    } finally {
      setRenaming(false);
    }
  };

  const selectedTemplate = selectedTask ? templatesByTask?.get(selectedTask.id) : undefined;

  return (
    <>
      <div className="runtime-task-history">
        {tasks.map((task) => (
          <TaskHistoryItem key={task.id} label={taskHistoryLabel(task, recordNames)} labelIsUrl={taskHistoryLabelIsUrl(task, recordNames)} navigate={navigate} onLongPress={() => { setDeleteIssue(undefined); setSelectedTask(task); }} task={task} />
        ))}
      </div>
      {selectedTask ? (
        <RecentRecordActionsSheet
          canDelete={isTerminalTaskStatus(selectedTask.status)}
          deleting={deleting}
          deleteDisabledReason="进行中的拆解不能删除，等待它进入明确终态后再试。"
          hasLocalVideo={selectedTask.contentType === "video"}
          issue={deleteIssue}
          kind="task"
          linkedTemplateName={selectedTemplate?.name}
          onClose={closeActions}
          onDelete={(options) => void deleteSelected(options)}
          onRename={selectedTemplate ? () => { setRenameTarget({ task: selectedTask, template: selectedTemplate }); setSelectedTask(undefined); } : undefined}
          open
          recordLabel={taskHistoryLabel(selectedTask, recordNames)}
          renameDisabledReason="该拆解还没有模板，可先在详情页存为模板。"
        />
      ) : null}
      {renameTarget ? (
        <RenameSheet
          busy={renaming}
          fieldLabel="模板名称"
          initialValue={renameTarget.template.name}
          issue={renameIssue}
          onClose={closeRename}
          onSubmit={(name) => void submitRename(name)}
          open
          title="重命名模板"
        />
      ) : null}
    </>
  );
}
