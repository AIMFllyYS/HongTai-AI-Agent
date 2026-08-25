import { useEffect, useState } from "react";
import type { TaskIssue } from "@hongtai/core";

import { Button } from "./Buttons";
import { Icon } from "./Icon";
import { Sheet, SheetActionRow } from "./Sheet";

export type RecentRecordKind = "task" | "observation";

export interface RecentRecordActionsSheetProps {
  readonly open: boolean;
  readonly kind: RecentRecordKind;
  readonly recordLabel: string;
  readonly canDelete: boolean;
  readonly deleteDisabledReason?: string;
  readonly deleting?: boolean;
  readonly issue?: TaskIssue;
  readonly onClose: () => void;
  readonly onDelete: () => void;
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
  onClose,
  onDelete,
}: RecentRecordActionsSheetProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open, recordLabel]);

  const close = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Sheet className="recent-record-actions-sheet" onClose={close} open={open} title={confirming ? "确认删除记录" : "记录操作"}>
      {confirming ? (
        <div className="recent-record-actions-sheet__confirm" role="alert">
          <div className="recent-record-actions-sheet__confirm-icon"><Icon name="trash_2" size={20} /></div>
          <strong>删除这条{kindLabels[kind]}？</strong>
          <p><span>{recordLabel}</span>的本机图片、媒体和结构化产物会一起移除，已保存的数据文件不会通过此入口删除。</p>
          {issue ? <p className="recent-record-actions-sheet__issue">{issue.userMessage}</p> : null}
          <div className="recent-record-actions-sheet__confirm-actions">
            <Button disabled={deleting} onClick={close} variant="quiet">取消</Button>
            <Button className={deleting ? "is-busy" : ""} disabled={deleting} onClick={onDelete} variant="primary">{deleting ? "正在删除" : "确认删除"}</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="recent-record-actions-sheet__label">{kindLabels[kind]} · {recordLabel}</p>
          <div className="sheet-action-list">
            <SheetActionRow
              description={canDelete ? "只移除这条记录的本机媒体与产物" : deleteDisabledReason}
              disabled={!canDelete || deleting}
              icon={<Icon name={canDelete ? "trash_2" : "lock"} size={20} />}
              onSelect={() => setConfirming(true)}
              title="删除记录"
            />
          </div>
          <Button className="sheet-cancel" onClick={close} variant="quiet">取消</Button>
        </>
      )}
    </Sheet>
  );
}
