import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { Button } from "./Buttons";
import { Sheet, SheetActionRow } from "./Sheet";

export interface TaskMoreActionItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
  readonly onSelect: () => void;
}

export interface TaskMoreActionsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly items: readonly TaskMoreActionItem[];
}

export function TaskMoreActionsSheet({ open, onClose, items }: TaskMoreActionsSheetProps) {
  return (
    <Sheet onClose={onClose} open={open} title="更多操作">
      <div className="sheet-action-list">
        {items.map((item) => (
          <SheetActionRow
            description={item.description}
            icon={<Icon name={item.icon} size={20} />}
            key={item.id}
            onSelect={() => {
              onClose();
              item.onSelect();
            }}
            title={item.title}
          />
        ))}
      </div>
      <Button className="sheet-cancel" onClick={onClose} variant="quiet">取消</Button>
    </Sheet>
  );
}
