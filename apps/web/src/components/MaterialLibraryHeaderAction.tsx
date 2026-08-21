import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function MaterialLibraryHeaderAction() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label="打开富迪素材库"
        className="material-library-entry"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <span className="material-library-entry__mark">
          <img alt="" draggable={false} src="/materials/fudi-library-promo.png" />
        </span>
        <span className="material-library-entry__caption">素材库</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="关闭富迪素材库"
              className="material-library-dialog__backdrop"
              onClick={close}
              role="presentation"
            >
              <section
                aria-labelledby="material-library-title"
                aria-modal="true"
                className="material-library-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <header className="material-library-dialog__header">
                  <strong id="material-library-title">富迪素材库</strong>
                  <button aria-label="关闭富迪素材库" onClick={close} ref={closeButtonRef} type="button">
                    <Icon name="close" size={20} />
                  </button>
                </header>
                <img
                  alt="富迪素材库宣传图"
                  className="material-library-dialog__image"
                  src="/materials/fudi-material-library.jpg"
                />
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
