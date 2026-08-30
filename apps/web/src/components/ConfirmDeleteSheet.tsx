import { Button } from "./Buttons";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface ConfirmDeleteSheetProps {
  readonly open: boolean;
  /** 弹层标题（视觉与无障碍共用），如「确认删除项目」。 */
  readonly title: string;
  /** 正文主问句，如「删除这个项目？」。 */
  readonly heading: string;
  /** 删除后果说明：什么会被删掉、什么会保留。 */
  readonly description: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
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
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDeleteSheetProps) {
  return (
    <Sheet className="confirm-delete-sheet" onClose={onClose} open={open} title={title}>
      <div className="confirm-delete-sheet__body" role="alert">
        <div className="confirm-delete-sheet__icon"><Icon name="trash_2" size={20} /></div>
        <strong>{heading}</strong>
        <p>{description}</p>
        <div className="confirm-delete-sheet__actions">
          <Button disabled={busy} onClick={onClose} variant="quiet">取消</Button>
          <Button className={busy ? "is-busy" : ""} disabled={busy} onClick={onConfirm} variant="primary">{busy ? "正在删除" : confirmLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
