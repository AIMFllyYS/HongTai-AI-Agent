import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createStandaloneAppRuntime, registerStandaloneNativePlugins } from "@hongtai/capacitor-runtime";
import type { AppRuntime } from "@hongtai/core";

import { App } from "./App";
import { AppShell } from "./components/AppShell";
import { Button } from "./components/Buttons";
import { ErrorState, LoadingState } from "./components/StatePanels";
import { NotificationProvider } from "./notifications/NotificationProvider";
import { installAppLifecycleCoordinator } from "./runtime/app-lifecycle";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用根节点");
}

// Android WebView does not consistently expose safe-area env values even
// while target-SDK edge-to-edge is enforced.  The shell uses this narrowly
// scoped baseline only for its fixed header; devices that expose a larger
// inset still win through CSS max().
document.documentElement.dataset.platform = Capacitor.getPlatform();

let runtimePromise: Promise<AppRuntime> | undefined;

function initializeRuntime(): Promise<AppRuntime> {
  runtimePromise ??= createStandaloneAppRuntime({
    plugins: registerStandaloneNativePlugins(registerPlugin),
    convertFileSrc: Capacitor.convertFileSrc,
  }).then(async (runtime) => {
    // Every state owner terminates snapshots left active by a prior WebView;
    // startup never attempts to replay a partially completed workflow.
    await runtime.recovery.recoverInterruptedWork();
    await installAppLifecycleCoordinator({
      subscribe: (listener) => CapacitorApp.addListener("appStateChange", listener),
      inspectUnfinishedWork: () => runtime.recovery.inspectUnfinishedWork(),
      reload: () => window.location.reload(),
      notifyResume: () => window.dispatchEvent(new Event("hongtai:app-resumed")),
    });
    return runtime;
  });
  return runtimePromise;
}

function RuntimeBootstrap() {
  const [runtime, setRuntime] = useState<AppRuntime>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void initializeRuntime().then(
      (nextRuntime) => {
        if (active) setRuntime(nextRuntime);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (runtime) return <App runtime={runtime} />;

  return (
    <AppShell navigate={() => undefined} showNav={false} title="宏泰AI智能体">
      {failed ? (
        <ErrorState
          action={<Button onClick={() => window.location.reload()} variant="secondary">重新打开应用</Button>}
          description="本地应用运行时未能启动。请在已安装的 Android APK 中重试；系统不会用临时或静态数据替代本地记录。"
          title="本地运行时不可用"
        />
      ) : <LoadingState description="正在启动本地应用运行时" title="启动本地应用运行时" />}
    </AppShell>
  );
}

createRoot(root).render(
  <StrictMode>
    <NotificationProvider>
      <RuntimeBootstrap />
    </NotificationProvider>
  </StrictMode>,
);
