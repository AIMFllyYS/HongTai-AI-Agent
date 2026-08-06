import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createCapacitorAppRuntime, registerHongTaiNativePlugins } from "@hongtai/capacitor-runtime";
import type { AppRuntime } from "@hongtai/core";

import { App } from "./App";
import { AppShell } from "./components/AppShell";
import { Button } from "./components/Buttons";
import { ErrorState, LoadingState } from "./components/StatePanels";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用根节点");
}

let runtimePromise: Promise<AppRuntime> | undefined;

function initializeRuntime(): Promise<AppRuntime> {
  runtimePromise ??= createCapacitorAppRuntime({
    plugins: registerHongTaiNativePlugins(registerPlugin),
    convertFileSrc: Capacitor.convertFileSrc,
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
          description="本机加密存储未能安全初始化。请在已安装的 Android APK 中重试；系统不会用临时或静态数据替代本地记录。"
          title="本地运行时不可用"
        />
      ) : <LoadingState description="正在建立 Android Keystore 与本地加密数据边界" title="启动本地运行时" />}
    </AppShell>
  );
}

createRoot(root).render(
  <StrictMode>
    <RuntimeBootstrap />
  </StrictMode>,
);
