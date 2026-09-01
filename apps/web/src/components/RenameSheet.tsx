import { useEffect, useState } from "react";
import type { TaskIssue } from "@hongtai/core";

import { Button } from "./Buttons";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface RenameSheetProps {
  readonly open: boolean;
  /** 弹层标题，如「重命名模板」。 */
  readonly title: string;
  /** 输入框标签，如「模板名称」。 */
  readonly fieldLabel: string;
  readonly initialValue: string;
  readonly maxLength?: number;
  readonly busy?: boolean;
  readonly issue?: TaskIssue;
  /** 提交非空且已 trim 的新名称；为空时组件内部拦截，不触发回调。 */
  readonly onSubmit: (value: string) => void;
  readonly onClose: () => void;
}

/**
 * 统一的重命名底部弹层：单行输入 + 保存/取消。名称的非空与长度约束与服务端
 * `normalizedInput` 一致（非空、默认最多 80 字符），超限错误由服务抛出并经调用方上屏。
 */
export function RenameSheet({
  open,
  title,
  fieldLabel,
  initialValue,
  maxLength = 80,
  busy = false,
  issue,
  onSubmit,
  onClose,
}: RenameSheetProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <Sheet className="rename-sheet" onClose={onClose} open={open} title={title}>
      <div className="rename-sheet__body">
        <label className="field-label" htmlFor="rename-sheet-input">{fieldLabel}</label>
        <input
          autoFocus
          disabled={busy}
          id="rename-sheet-input"
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
          value={value}
        />
        {issue ? <p className="rename-sheet__issue">{issue.userMessage}</p> : null}
        <div className="rename-sheet__actions">
          <Button disabled={busy} onClick={onClose} variant="quiet">取消</Button>
          <Button className={busy ? "is-busy" : ""} disabled={busy || !trimmed} icon={<Icon name="check_circle" size={17} />} onClick={submit} variant="primary">
            {busy ? "正在保存" : "保存名称"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
