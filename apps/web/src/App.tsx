import type { AppRuntime } from "@hongtai/core";

import { EmptyState } from "./components/StatePanels";
import { activeNavForRoute, BottomNav } from "./components/BottomNav";
import { AppShell, AppShellNavigationProvider } from "./components/AppShell";
import { RouteTransition } from "./components/RouteTransition";
import { SwipeRouteViewport } from "./components/SwipeRouteViewport";
import type { VisualDataAdapter } from "./data/visual-adapter";
import { useInteractionFeedback } from "./hooks/useInteractionFeedback";
import { useBrowserRoute } from "./hooks/useBrowserRoute";
import { matchRoute } from "./router";
import { AnalysisResultPage } from "./pages/AnalysisResultPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { CreatePage } from "./pages/CreatePage";
import { DetailPage } from "./pages/DetailPage";
import { HomePage } from "./pages/HomePage";
import { ObservationReportPage } from "./pages/ObservationReportPage";
import { ObservationStartPage } from "./pages/ObservationStartPage";
import { ProcessingPage } from "./pages/ProcessingPage";
import { TaskAnalysisPage } from "./pages/TaskAnalysisPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { TaskHomePage } from "./pages/TaskHomePage";
import { TaskProcessingPage } from "./pages/TaskProcessingPage";
import { PublishPage } from "./pages/PublishPage";
import { AiSettingsPage } from "./pages/AiSettingsPage";
import { ProfileSettingsPage } from "./pages/ProfileSettingsPage";
import { SettingsPage } from "./pages/SettingsPage";

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
        : <RuntimePendingPage description="请在已启动本地应用运行时的 APK 中打开设置。" navigate={navigate} title="本地运行时未初始化" />;
    }
    if (renderedRoute.key === "settings-profile") {
      return runtime
        ? <ProfileSettingsPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="本地档案需要通过应用运行时读取。" navigate={navigate} title="本地运行时未初始化" />;
    }
    if (renderedRoute.key === "settings-ai") {
      return runtime
        ? <AiSettingsPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="AI 设置需要通过应用运行时读取。" navigate={navigate} title="本地运行时未初始化" />;
    }
    if (runtime && renderedRoute.key === "home") return <TaskHomePage navigate={navigate} runtime={runtime} />;
    if (runtime && renderedRoute.key === "task-processing") {
      const taskId = renderedRoute.params.taskId;
      return taskId
        ? <TaskProcessingPage key={taskId} navigate={navigate} runtime={runtime} taskId={taskId} />
        : <RuntimePendingPage description="任务路由缺少有效标识。" navigate={navigate} title="无法读取任务" />;
    }
    if (runtime && renderedRoute.key === "task-detail") {
      const taskId = renderedRoute.params.taskId;
      return taskId
        ? <TaskDetailPage key={taskId} navigate={navigate} runtime={runtime} taskId={taskId} />
        : <RuntimePendingPage description="任务路由缺少有效标识。" navigate={navigate} title="无法读取任务" />;
    }
    if (runtime && renderedRoute.key === "task-analysis") {
      const taskId = renderedRoute.params.taskId;
      return taskId
        ? <TaskAnalysisPage key={taskId} navigate={navigate} runtime={runtime} taskId={taskId} />
        : <RuntimePendingPage description="任务路由缺少有效标识。" navigate={navigate} title="无法读取任务" />;
    }
    if (runtime && renderedRoute.key === "observation-new") {
      return <ObservationStartPage navigate={navigate} runtime={runtime} />;
    }
    if (runtime && renderedRoute.key === "observation-report") {
      const sessionId = renderedRoute.params.sessionId;
      return sessionId
        ? <ObservationReportPage key={sessionId} navigate={navigate} runtime={runtime} sessionId={sessionId} />
        : <RuntimePendingPage description="观察路由缺少有效标识。" navigate={navigate} title="无法读取观察会话" />;
    }
    if (runtime && renderedRoute.key === "create") {
      return <CreatePage navigate={navigate} runtime={runtime} />;
    }
    if (runtime && renderedRoute.key === "templates") {
      return <TemplatesPage navigate={navigate} runtime={runtime} />;
    }
    if (runtime && renderedRoute.key === "publish") {
      return <PublishPage capability={runtime.features.publish} navigate={navigate} />;
    }

    // Visual fixtures remain available only to explicit design/test callers.
    if (visualData) {
      if (renderedRoute.key === "home") return <HomePage navigate={navigate} viewModel={visualData.getHome()} />;
      if (renderedRoute.key === "processing") return <ProcessingPage navigate={navigate} viewModel={visualData.getProcessing()} />;
      if (renderedRoute.key === "analysis-result") return <AnalysisResultPage navigate={navigate} viewModel={visualData.getAnalysisResult()} />;
      if (renderedRoute.key === "video-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("video")} />;
      if (renderedRoute.key === "gallery-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("gallery")} />;
      if (renderedRoute.key === "create") return <CreatePage navigate={navigate} viewModel={visualData.getCreate()} />;
      if (renderedRoute.key === "publish") return <PublishPage navigate={navigate} viewModel={visualData.getPublish()} />;
    }

    const unsupported = renderedRoute.key === "not-found"
      ? `没有找到页面：${renderedRoute.path}`
      : "该界面正在等待对应的本地应用能力接入，不会展示伪造的任务、媒体或结果。";
    return <RuntimePendingPage description={unsupported} navigate={navigate} title={renderedRoute.key === "not-found" ? "页面不存在" : "能力尚未接入"} />;
  };

  const route = matchRoute(pathname);
  const activeNav = activeNavForRoute(route.key);
  const visualTheme = route.key === "observation-new" || route.key === "observation-report" ? "warm-soft-tech" : "workbench";

  return (
    <AppShellNavigationProvider>
      <SwipeRouteViewport active={activeNav} currentPath={pathname} navigate={navigate} renderRoute={renderRoute}>
        <RouteTransition direction={direction} pathname={pathname} transitionMode={transitionMode}>{renderRoute(pathname)}</RouteTransition>
      </SwipeRouteViewport>
      <BottomNav active={activeNav} navigate={navigate} visualTheme={visualTheme} />
    </AppShellNavigationProvider>
  );
}
