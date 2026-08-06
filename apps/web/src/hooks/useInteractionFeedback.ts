import { useEffect } from "react";
import { playInteractionFeedback, type InteractionFeedbackKind } from "../services/interaction-feedback";

const INTERACTIVE_SELECTOR = "button:not(:disabled), a[href], [role=\"button\"], [data-feedback]";

function feedbackKind(element: HTMLElement): InteractionFeedbackKind {
  return element.dataset.feedback === "navigate" || Boolean(element.closest(".bottom-nav")) ? "navigate" : "press";
}

export function useInteractionFeedback(): void {
  useEffect(() => {
    const reducedMotionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    const handleClick = (event: MouseEvent) => {
      if (reducedMotionQuery?.matches) return;
      if (!(event.target instanceof Element)) return;

      const target = event.target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!target || target.dataset.feedback === "none" || target.getAttribute("aria-disabled") === "true") return;

      playInteractionFeedback(feedbackKind(target));
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);
}
