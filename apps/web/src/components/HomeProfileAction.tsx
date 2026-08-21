import { useEffect, useState } from "react";
import type { AppRuntime, LocalProfile } from "@hongtai/core";
import { pathForRoute, type Navigate } from "../router";

export interface HomeProfileActionProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

export function HomeProfileAction({ runtime, navigate }: HomeProfileActionProps) {
  const [profile, setProfile] = useState<LocalProfile>();

  useEffect(() => {
    let cancelled = false;
    void runtime.profile.get().then((next) => {
      if (!cancelled) setProfile(next);
    }).catch(() => {
      if (!cancelled) setProfile(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const name = profile?.displayName?.trim();
  const initial = name ? Array.from(name)[0] ?? "宏" : "宏";

  return (
    <button aria-label="打开设置" className="masthead-avatar" onClick={() => navigate(pathForRoute("settings"), { scroll: "auto", transition: "primary" })} type="button">
      {profile?.avatarUri ? <img alt="" src={profile.avatarUri} /> : initial}
    </button>
  );
}
