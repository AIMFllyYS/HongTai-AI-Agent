import { lazy, Suspense } from "react";
import type { AppRuntime } from "@hongtai/core";

import { EmptyState, LoadingState } from "./components/StatePanels";
import { activeNavForRoute, BottomNav } from "./components/BottomNav";
import { AppShell, AppShellNavigationProvider } from "./components/AppShell";
import { RouteTransition } from "./components/RouteTransition";
import { SwipeRouteViewport } from "./components/SwipeRouteViewport";
import type { VisualDataAdapter } from "./data/visual-adapter";
import { useInteractionFeedback } from "./hooks/useInteractionFeedback";
import { useBrowserRoute } from "./hooks/useBrowserRoute";
import { isTaskPageAlias, matchRoute } from "./router";
import { HomePage } from "./pages/HomePage";
import { TaskHomePage } from "./pages/TaskHomePage";

const TemplatesPage = lazy(async () => ({ default: (await import("./pages/TemplatesPage")).TemplatesPage }));
const CreatePage = lazy(async () => ({ default: (await import("./pages/CreatePage")).CreatePage }));
const ProductionEditPage = lazy(async () => ({ default: (await import("./pages/ProductionEditPage")).ProductionEditPage }));
const ReplicaWizardPage = lazy(async () => ({ default: (await import("./pages/ReplicaWizardPage")).ReplicaWizardPage }));
const ObservationReportPage = lazy(async () => ({ default: (await import("./pages/ObservationReportPage")).ObservationReportPage }));
const ObservationStartPage = lazy(async () => ({ default: (await import("./pages/ObservationStartPage")).ObservationStartPage }));
const TaskPage = lazy(async () => ({ default: (await import("./pages/TaskPage")).TaskPage }));
const AiSettingsPage = lazy(async () => ({ default: (await import("./pages/AiSettingsPage")).AiSettingsPage }));
const ApplicationInfoPage = lazy(async () => ({ default: (await import("./pages/ApplicationInfoPage")).ApplicationInfoPage }));
const ProfileSettingsPage = lazy(async () => ({ default: (await import("./pages/ProfileSettingsPage")).ProfileSettingsPage }));
const SettingsPage = lazy(async () => ({ default: (await import("./pages/SettingsPage")).SettingsPage }));

export interface AppProps {
  /** Real application runtime supplied only by the application composition root. */
  readonly runtime?: AppRuntime;
  /** Explicit design/test fixture; it is never created by the production entry. */
  readonly visualData?: VisualDataAdapter;
}

function RuntimePendingPage({ navigate, title, description }: { readonly navigate: (path: string) => void; readonly title: string; readonly description: string }) {
  return (
    <AppShell activeNav="home" navigate={navigate} title="宏泰AI智能体">
      <EmptyState description={description} icon="pending" title={title} />
    </AppShell>
  );
}

export function App({ runtime, visualData }: AppProps = {}) {
  const { pathname, direction, transitionMode, navigate } = useBrowserRoute();
  useInteractionFeedback();

  const renderRoute = (path: string) => {
    const renderedRoute = matchRoute(path);
    if (renderedRoute.key === "settings") {
      return runtime
        ? <SettingsPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="设置暂时无法读取，请重新打开已安装的应用。" navigate={navigate} title="设置暂时不可用" />;
    }
    if (renderedRoute.key === "settings-profile") {
      return runtime
        ? <ProfileSettingsPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="个人资料暂时无法读取，请重新打开应用。" navigate={navigate} title="个人资料暂时不可用" />;
    }
    if (renderedRoute.key === "settings-ai") {
      return runtime
        ? <AiSettingsPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="AI 设置暂时无法读取，请重新打开应用。" navigate={navigate} title="AI 设置暂时不可用" />;
    }
    if (renderedRoute.key === "settings-app-info") {
      return runtime
        ? <ApplicationInfoPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="版本信息暂时无法读取，请重新打开应用。" navigate={navigate} title="应用信息暂时不可用" />;
    }
    if (runtime && renderedRoute.key === "home") return <TaskHomePage navigate={navigate} runtime={runtime} />;
    if (runtime && isTaskPageAlias(renderedRoute.key)) {
      const taskId = renderedRoute.params.taskId;
      return taskId
        ? <TaskPage key={taskId} navigate={navigate} runtime={runtime} taskId={taskId} />
        : <RuntimePendingPage description="这个任务链接不完整，请返回任务列表重新进入。" navigate={navigate} title="无法打开任务" />;
    }
    if (runtime && renderedRoute.key === "observation-new") {
      return <ObservationStartPage navigate={navigate} runtime={runtime} />;
    }
    if (runtime && renderedRoute.key === "observation-report") {
      const sessionId = renderedRoute.params.sessionId;
      return sessionId
        ? <ObservationReportPage key={sessionId} navigate={navigate} runtime={runtime} sessionId={sessionId} />
        : <RuntimePendingPage description="这个报告链接不完整，请返回观察记录重新进入。" navigate={navigate} title="无法打开观察报告" />;
    }
    if (runtime && renderedRoute.key === "create") {
      return <CreatePage navigate={navigate} runtime={runtime} />;
    }
    if (runtime && renderedRoute.key === "production-edit") {
      const projectId = renderedRoute.params.projectId;
      return projectId
        ? <ProductionEditPage key={projectId} navigate={navigate} projectId={projectId} runtime={runtime} />
        : <RuntimePendingPage description="这个微调链接不完整，请返回制作页重新进入。" navigate={navigate} title="无法打开微调" />;
    }
    if (runtime && renderedRoute.key === "replica-wizard") {
      const taskId = renderedRoute.params.taskId;
      return taskId
        ? <ReplicaWizardPage key={taskId} navigate={navigate} runtime={runtime} taskId={taskId} />
        : <RuntimePendingPage description="这个复刻链接不完整，请返回任务详情重新进入。" navigate={navigate} title="无法打开复刻向导" />;
    }
    if (runtime && renderedRoute.key === "templates") {
      return <TemplatesPage navigate={navigate} runtime={runtime} />;
    }

    // Visual fixtures remain available only to explicit design/test callers.
    if (visualData) {
      if (renderedRoute.key === "home") return <HomePage navigate={navigate} viewModel={visualData.getHome()} />;
      if (renderedRoute.key === "create") return <CreatePage navigate={navigate} viewModel={visualData.getCreate()} />;
    }

    const unsupported = renderedRoute.key === "not-found"
      ? `没有找到页面：${renderedRoute.path}`
      : "这项功能还没有开放，请返回使用其他功能。";
    return <RuntimePendingPage description={unsupported} navigate={navigate} title={renderedRoute.key === "not-found" ? "页面不存在" : "能力尚未接入"} />;
  };

  const route = matchRoute(pathname);
  const activeNav = activeNavForRoute(route.key);

  return (
    <AppShellNavigationProvider>
      <SwipeRouteViewport active={activeNav} currentPath={pathname} navigate={navigate}>
        <RouteTransition direction={direction} pathname={pathname} transitionMode={transitionMode}>
          <Suspense fallback={<LoadingState title="正在打开页面" />}>{renderRoute(pathname)}</Suspense>
        </RouteTransition>
      </SwipeRouteViewport>
      <BottomNav active={activeNav} navigate={navigate} />
    </AppShellNavigationProvider>
  );
}
