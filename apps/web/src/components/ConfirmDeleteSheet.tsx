import type { TaskIssue } from "@hongtai/core";

import { Button } from "./Buttons";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface ConfirmDeleteCheckbox {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export interface ConfirmDeleteSheetProps {
  readonly open: boolean;
  /** 弹层标题（视觉与无障碍共用），如「确认删除项目」。 */
  readonly title: string;
  /** 正文主问句，如「删除这个项目？」。 */
  readonly heading: string;
  /** 删除后果说明：什么会被删掉、什么会保留。 */
  readonly description: string;
  /** 醒目红色警示：级联删除等不可逆的连带后果，如「将同时彻底删除对应模板」。 */
  readonly dangerNote?: string;
  /** 可勾选项：由用户决定不可逆操作的范围，如「同时删除已下载到本机的视频」。 */
  readonly checkbox?: ConfirmDeleteCheckbox;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  /** 上一次删除失败的原因；在弹层内原位展示，便于用户重试。 */
  readonly issue?: TaskIssue;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/**
 * 全应用统一的删除确认形态：底部上拉弹层，与观察记录、拆解记录、存储清理一致。
 * 任何删除入口不得再内嵌确认区到列表或面板里。
 */
export function ConfirmDeleteSheet({
  open,
  title,
  heading,
  description,
  dangerNote,
  checkbox,
  confirmLabel,
  busy = false,
  issue,
  onConfirm,
  onClose,
}: ConfirmDeleteSheetProps) {
  return (
    <Sheet className="confirm-delete-sheet" onClose={onClose} open={open} title={title}>
      <div className="confirm-delete-sheet__body" role="alert">
        <div className="confirm-delete-sheet__icon"><Icon name="trash_2" size={20} /></div>
        <strong>{heading}</strong>
        <p>{description}</p>
        {dangerNote ? (
          <p className="confirm-delete-sheet__danger"><Icon name="error" size={18} /><span>{dangerNote}</span></p>
        ) : null}
        {checkbox ? (
          <label className="confirm-delete-sheet__checkbox">
            <input
              checked={checkbox.checked}
              disabled={busy}
              onChange={(event) => checkbox.onChange(event.target.checked)}
              type="checkbox"
            />
            <span>{checkbox.label}</span>
          </label>
        ) : null}
        {issue ? <p className="confirm-delete-sheet__issue">{issue.userMessage}</p> : null}
        <div className="confirm-delete-sheet__actions">
          <Button disabled={busy} onClick={onClose} variant="quiet">取消</Button>
          <Button className={busy ? "is-danger is-busy" : "is-danger"} disabled={busy} onClick={onConfirm} variant="primary">{busy ? "正在删除" : confirmLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
