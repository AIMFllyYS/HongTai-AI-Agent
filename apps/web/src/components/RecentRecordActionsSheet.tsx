import { useEffect, useState } from "react";
import type { TaskIssue } from "@hongtai/core";

import { Button } from "./Buttons";
import { ConfirmDeleteSheet } from "./ConfirmDeleteSheet";
import { Icon } from "./Icon";
import { Sheet, SheetActionRow } from "./Sheet";

export type RecentRecordKind = "task" | "observation";

export interface RecentRecordDeleteOptions {
  /** true = 保留本机已下载/导入的视频文件；false 或未勾选时连同视频一起删除。 */
  readonly keepLocalVideo: boolean;
}

export interface RecentRecordActionsSheetProps {
  readonly open: boolean;
  readonly kind: RecentRecordKind;
  readonly recordLabel: string;
  readonly canDelete: boolean;
  readonly deleteDisabledReason?: string;
  readonly deleting?: boolean;
  readonly issue?: TaskIssue;
  /** 提供后出现「重命名」行；缺省时该行禁用并展示 renameDisabledReason。 */
  readonly onRename?: () => void;
  readonly renameDisabledReason?: string;
  /** 与这条拆解联动的模板名称；删除确认时以红色警示说明会被一并彻底删除。 */
  readonly linkedTemplateName?: string;
  /** 本机是否留有该记录的视频文件；为 true 时删除确认弹层提供「同时删除视频」勾选框。 */
  readonly hasLocalVideo?: boolean;
  readonly onClose: () => void;
  readonly onDelete: (options: RecentRecordDeleteOptions) => void;
}

const kindLabels: Readonly<Record<RecentRecordKind, string>> = {
  task: "拆解记录",
  observation: "观察记录",
};

export function RecentRecordActionsSheet({
  open,
  kind,
  recordLabel,
  canDelete,
  deleteDisabledReason = "进行中的记录不能删除，完成后可再试。",
  deleting = false,
  issue,
  onRename,
  renameDisabledReason = "该记录还没有可重命名的名称。",
  linkedTemplateName,
  hasLocalVideo = false,
  onClose,
  onDelete,
}: RecentRecordActionsSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleteLocalVideo, setDeleteLocalVideo] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setDeleteLocalVideo(false);
    }
  }, [open, recordLabel]);

  const close = () => {
    setConfirming(false);
    setDeleteLocalVideo(false);
    onClose();
  };

  if (confirming) {
    return (
      <ConfirmDeleteSheet
        busy={deleting}
        checkbox={hasLocalVideo ? { label: "同时删除已下载到本机的视频", checked: deleteLocalVideo, onChange: setDeleteLocalVideo } : undefined}
        confirmLabel="确认删除"
        dangerNote={kind === "task" && linkedTemplateName ? `将同时彻底删除模板「${linkedTemplateName}」，无法恢复。` : undefined}
        description={`「${recordLabel}」的本机图片、媒体和结构化产物会一起移除。`}
        heading={`确认删除这条${kindLabels[kind]}？`}
        issue={issue}
        onClose={close}
        onConfirm={() => onDelete({ keepLocalVideo: !(hasLocalVideo && deleteLocalVideo) })}
        open={open}
        title="确认删除记录"
      />
    );
  }

  return (
    <Sheet className="recent-record-actions-sheet" onClose={close} open={open} title="记录操作">
      <p className="recent-record-actions-sheet__label">{kindLabels[kind]} · {recordLabel}</p>
      <div className="sheet-action-list">
        {kind === "task" ? (
          <SheetActionRow
            description={onRename ? "修改这条拆解对应模板的名称" : renameDisabledReason}
            disabled={!onRename || deleting}
            icon={<Icon name={onRename ? "pen_line" : "lock"} size={20} />}
            onSelect={() => onRename?.()}
            title="重命名"
          />
        ) : null}
        <SheetActionRow
          description={canDelete ? (linkedTemplateName ? "对应模板会一并删除，本机视频可选择保留" : "移除这条记录的本机媒体与产物") : deleteDisabledReason}
          disabled={!canDelete || deleting}
          icon={<Icon name={canDelete ? "trash_2" : "lock"} size={20} />}
          onSelect={() => setConfirming(true)}
          title="删除记录"
        />
      </div>
      <Button className="sheet-cancel" onClick={close} variant="quiet">取消</Button>
    </Sheet>
  );
}
