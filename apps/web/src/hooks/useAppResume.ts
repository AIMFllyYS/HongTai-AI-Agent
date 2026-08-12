import { useEffect, useRef } from "react";

/** Re-run a UI-safe persisted DTO loader after a normal Android resume. */
export function useAppResume(callback: () => void | Promise<void>): void {
  const current = useRef(callback);
  current.current = callback;

  useEffect(() => {
    const handle = () => { void current.current(); };
    window.addEventListener("hongtai:app-resumed", handle);
    return () => window.removeEventListener("hongtai:app-resumed", handle);
  }, []);
}
