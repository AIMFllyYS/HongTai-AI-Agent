import { useEffect, useState } from "react";
import type { AppRuntime } from "@hongtai/core";
import { pathForRoute, type Navigate } from "../router";

export interface HomeProfileActionProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

export function HomeProfileAction({ runtime, navigate }: HomeProfileActionProps) {
  const [initial, setInitial] = useState("");

  useEffect(() => {
    let cancelled = false;
    void runtime.profile.get().then((profile) => {
      if (cancelled) return;
      const name = profile?.displayName?.trim();
      setInitial(name ? Array.from(name)[0] ?? "" : "");
    }).catch(() => {
      if (!cancelled) setInitial("");
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  return (
    <button aria-label="打开设置" className="masthead-avatar" onClick={() => navigate(pathForRoute("settings"))} type="button">
      {initial || "宏"}
    </button>
  );
}
