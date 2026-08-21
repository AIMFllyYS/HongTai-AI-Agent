import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { PageSkeleton } from "../components/PageSkeleton";
import { ErrorState } from "../components/StatePanels";
import { OFFICIAL_UPDATE_LOG_URL } from "../data/official-update-log";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { appInfoSettingsPath } from "../router";

export interface UpdateLogPageProps {
  readonly navigate: (path: string) => void;
}

type FrameStatus = "loading" | "ready" | "failed";

const LOAD_TIMEOUT_MS = 20_000;

export function UpdateLogPage({ navigate }: UpdateLogPageProps) {
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [loadKey, setLoadKey] = useState(0);
  const showSkeleton = useSkeletonHold(status === "loading");

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "failed" : current));
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loadKey, status]);

  const retry = useCallback(() => {
    setStatus("loading");
    setLoadKey((value) => value + 1);
  }, []);

  return (
    <AppShell
      activeNav="settings"
      backPath={appInfoSettingsPath()}
      className="app-shell--update-log"
      navigate={navigate}
      subtitle="官方下载与版本记录"
      title="更新日志"
    >
      <div className={`page-update-log${status === "failed" ? " page-update-log--failed" : ""}`}>
        {status === "failed" ? (
          <ErrorState
            action={<Button onClick={retry} variant="secondary">重新加载</Button>}
            description="需要网络才能打开官方更新页。请检查连接后重试。"
            title="官方更新页暂时打不开"
          />
        ) : (
          <>
            {showSkeleton ? <PageSkeleton layout="settings" /> : null}
            <iframe
              aria-hidden={showSkeleton}
              className={`update-log-frame${status === "ready" && !showSkeleton ? " is-ready" : ""}`}
              key={loadKey}
              onError={() => setStatus("failed")}
              onLoad={() => setStatus("ready")}
              referrerPolicy="no-referrer-when-downgrade"
              src={OFFICIAL_UPDATE_LOG_URL}
              title="宏泰 AI 智能体官方更新日志"
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
