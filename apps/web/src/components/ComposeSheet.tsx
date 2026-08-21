import { composeActions, pathForComposeAction } from "../navigation/compose-actions";
import type { Navigate } from "../router";
import { Button } from "./Buttons";
import { Icon } from "./Icon";
import { Sheet, SheetActionRow } from "./Sheet";

export interface ComposeSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly navigate: Navigate;
}

export function ComposeSheet({ open, onClose, navigate }: ComposeSheetProps) {
  return (
    <Sheet onClose={onClose} open={open} title="新建">
      <div className="sheet-action-list">
        {composeActions.map((action) => (
          <SheetActionRow
            description={action.description}
            icon={<Icon name={action.icon} size={16} />}
            key={action.id}
            onSelect={() => {
              onClose();
              navigate(pathForComposeAction(action.id));
            }}
            title={action.title}
          />
        ))}
      </div>
      <Button className="sheet-cancel" onClick={onClose} variant="quiet">取消</Button>
    </Sheet>
  );
}
