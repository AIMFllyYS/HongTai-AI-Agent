import type { PropsWithChildren, ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface SheetProps extends PropsWithChildren {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly labelledBy?: string;
  readonly className?: string;
}

export function Sheet({ open, title, onClose, labelledBy = "sheet-title", className = "", children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="sheet-backdrop" data-no-swipe="" onClick={onClose} role="presentation">
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`sheet ${className}`.trim()}
        data-no-swipe=""
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet__handle" />
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
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
