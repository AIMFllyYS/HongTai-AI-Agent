/** Syncs keyboard overlap into `--keyboard-inset`. Chromium 61+; no-op without visualViewport. */
export function installVisualViewportInset(target: CSSStyleDeclaration = document.documentElement.style): () => void {
  const viewport = window.visualViewport;
  const apply = () => {
    const inset = viewport
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    target.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
  };
  apply();
  if (!viewport) {
    return () => { target.removeProperty("--keyboard-inset"); };
  }
  const revealFocusedField = (event: Event) => {
    const field = event.target;
    if (typeof HTMLElement === "undefined" || !(field instanceof HTMLElement)) return;
    if (field.tagName !== "INPUT" && field.tagName !== "TEXTAREA") return;
    window.setTimeout(() => {
      field.scrollIntoView({ block: "center", inline: "nearest" });
    }, 50);
  };
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  window.addEventListener("focusin", apply);
  window.addEventListener("focusin", revealFocusedField);
  window.addEventListener("focusout", apply);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    window.removeEventListener("focusin", apply);
    window.removeEventListener("focusin", revealFocusedField);
    window.removeEventListener("focusout", apply);
    target.removeProperty("--keyboard-inset");
  };
}
