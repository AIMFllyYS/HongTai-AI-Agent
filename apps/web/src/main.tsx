import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createStandaloneAppRuntime, registerStandaloneNativePlugins } from "@hongtai/capacitor-runtime";
import type { AppRuntime } from "@hongtai/core";

import { App } from "./App";
import { AppShell } from "./components/AppShell";
import { BrandSplash } from "./components/BrandSplash";
import { Button } from "./components/Buttons";
import { ErrorState } from "./components/StatePanels";
import { NotificationProvider } from "./notifications/NotificationProvider";
import { installAppLifecycleCoordinator } from "./runtime/app-lifecycle";
import { useBrandSplashReady } from "./runtime/brand-splash";
import { installVisualViewportInset } from "./runtime/visual-viewport-inset";
import { applyStoredAppearancePreferences } from "./runtime/appearance-preferences";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少应用根节点");
}

// Android WebView does not consistently expose safe-area env values even
// while target-SDK edge-to-edge is enforced.  The shell uses this narrowly
// scoped baseline for the fixed header and bottom chrome; devices that
// expose a larger inset still win through CSS max().
document.documentElement.dataset.platform = Capacitor.getPlatform();
applyStoredAppearancePreferences();
installVisualViewportInset();

let runtimePromise: Promise<AppRuntime> | undefined;

function initializeRuntime(): Promise<AppRuntime> {
  runtimePromise ??= (async () => {
    const native = Capacitor.isNativePlatform();
    const plugins = native
      ? registerStandaloneNativePlugins(registerPlugin)
      : (await import("./runtime/browser-native/create-browser-plugins")).createBrowserStandalonePlugins();
    const convertFileSrc = native
      ? Capacitor.convertFileSrc
      : (await import("./runtime/browser-native/create-browser-plugins")).browserConvertFileSrc;
    const runtime = await createStandaloneAppRuntime({ plugins, convertFileSrc });
    await runtime.recovery.recoverInterruptedWork();
    await installAppLifecycleCoordinator({
      subscribe: async (listener) => {
        try {
          return await CapacitorApp.addListener("appStateChange", listener);
        } catch {
          return { remove: async () => undefined };
        }
      },
      notifyResume: () => window.dispatchEvent(new Event("hongtai:app-resumed")),
    });
    return runtime;
  })();
  return runtimePromise;
}

function RuntimeBootstrap() {
  const [runtime, setRuntime] = useState<AppRuntime>();
  const [failed, setFailed] = useState(false);
  const splashReady = useBrandSplashReady();

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

  if (failed) {
    return (
      <AppShell navigate={() => undefined} showNav={false} title="宏泰AI智能体">
        <ErrorState
          action={<Button onClick={() => window.location.reload()} variant="secondary">重新打开应用</Button>}
          description="应用暂时没有正常启动，请重新打开。如果仍然失败，请保留当前页面并联系维护人员。"
          title="应用启动失败"
        />
      </AppShell>
    );
  }

  if (runtime && splashReady) return <App runtime={runtime} />;
  return <BrandSplash />;
}

createRoot(root).render(
  <StrictMode>
    <NotificationProvider>
      <RuntimeBootstrap />
    </NotificationProvider>
  </StrictMode>,
);
