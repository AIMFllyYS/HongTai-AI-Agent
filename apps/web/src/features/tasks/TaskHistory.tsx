import { safeUrlForDisplay } from "@hongtai/core";
import type { AppTaskRecord } from "@hongtai/core";

import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/StatePanels";
import { TaskStatusBadge } from "../../components/TaskStatusBadge";
import { taskDetailPath, type Navigate } from "../../router";
import { formatTaskTime, platformLabel } from "./task-presenters";

export function TaskHistory({ tasks, navigate }: { readonly tasks: readonly AppTaskRecord[]; readonly navigate: Navigate }) {
  if (tasks.length === 0) {
    return <EmptyState description="完成一次真实采集后，任务会保存在这里。" icon="history" title="还没有本地任务" />;
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
