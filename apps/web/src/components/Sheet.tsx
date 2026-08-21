import type { PropsWithChildren, ReactNode } from "react";

import { Overlay, OverlayDragRegion } from "./Overlay";

export interface SheetProps extends PropsWithChildren {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly labelledBy?: string;
  readonly className?: string;
}

export function Sheet({ open, title, onClose, labelledBy = "sheet-title", className = "", children }: SheetProps) {
  return (
    <Overlay labelledBy={labelledBy} onClose={onClose} open={open} panelClassName={`sheet ${className}`.trim()} placement="rise">
      <OverlayDragRegion className="sheet__grab">
        <div className="sheet__handle" />
        <h2 id={labelledBy}>{title}</h2>
      </OverlayDragRegion>
      <div className="sheet__body">{children}</div>
    </Overlay>
  );
}

export interface SheetActionRowProps {
  readonly title: string;
  readonly description?: string;
  readonly onSelect: () => void;
  readonly icon?: ReactNode;
}

export function SheetActionRow({ title, description, onSelect, icon }: SheetActionRowProps) {
  return (
    <button className="sheet-action" onClick={onSelect} type="button">
      {icon ? <span className="sheet-action__icon">{icon}</span> : null}
      <span className="sheet-action__copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}
