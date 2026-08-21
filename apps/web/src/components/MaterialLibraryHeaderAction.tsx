import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { Overlay } from "./Overlay";

export function MaterialLibraryHeaderAction() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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
      <Overlay
        initialFocusRef={closeButtonRef}
        labelledBy="material-library-title"
        onClose={close}
        open={open}
        panelClassName="material-library-dialog"
        placement="center"
        returnFocusRef={triggerRef}
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
      </Overlay>
    </>
  );
}
