import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Tracks the rendered width of one element so layouts authored in reference pixels can be
 * scaled to the real frame. Returns 0 until the element has been measured.
 */
export function useMeasuredWidth<T extends HTMLElement>(): readonly [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const apply = () => {
      const measured = node.getBoundingClientRect().width;
      setWidth((current) => (Math.abs(current - measured) < 0.5 ? current : measured));
    };
    apply();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
