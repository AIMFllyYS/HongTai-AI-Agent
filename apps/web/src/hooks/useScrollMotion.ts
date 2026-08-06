import { useEffect, useState } from "react";

export type ScrollMotionState = "top" | "scrolled";

export function useScrollMotion(threshold = 8): ScrollMotionState {
  const [state, setState] = useState<ScrollMotionState>(() => (
    typeof window !== "undefined" && window.scrollY > threshold ? "scrolled" : "top"
  ));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        setState(window.scrollY > threshold ? "scrolled" : "top");
        frame = 0;
      });
    };

    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", update);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return state;
}
