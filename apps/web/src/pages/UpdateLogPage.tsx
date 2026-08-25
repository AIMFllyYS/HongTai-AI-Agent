import { useCallback, useEffect, useRef, useState } from "react";

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
  const frameLoadedRef = useRef(false);
  const loadFinishedRef = useRef(false);
  const probeSucceededRef = useRef(false);
  const showSkeleton = useSkeletonHold(status === "loading");

  useEffect(() => {
    frameLoadedRef.current = false;
    loadFinishedRef.current = false;
    probeSucceededRef.current = false;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!active || loadFinishedRef.current) return;
      loadFinishedRef.current = true;
      setStatus("failed");
      controller.abort();
    }, LOAD_TIMEOUT_MS);
    void fetch(OFFICIAL_UPDATE_LOG_URL, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!active) return;
        probeSucceededRef.current = true;
        if (frameLoadedRef.current) {
          loadFinishedRef.current = true;
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!active) return;
        loadFinishedRef.current = true;
        setStatus("failed");
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadKey]);

  const retry = useCallback(() => {
    setStatus("loading");
    setLoadKey((value) => value + 1);
  }, []);

  const markFrameLoaded = useCallback(() => {
    frameLoadedRef.current = true;
    if (probeSucceededRef.current) {
      loadFinishedRef.current = true;
      setStatus("ready");
    }
  }, []);

  const markFrameFailed = useCallback(() => {
    loadFinishedRef.current = true;
    setStatus("failed");
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
              onError={markFrameFailed}
              onLoad={markFrameLoaded}
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
