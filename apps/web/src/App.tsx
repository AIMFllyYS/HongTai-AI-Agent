import { lazy, Suspense } from "react";
import type { AppRuntime } from "@hongtai/core";

import { EmptyState } from "./components/StatePanels";
import { PageSkeleton } from "./components/PageSkeleton";
import { activeNavForRoute, BottomNav } from "./components/BottomNav";
import { AppShell, AppShellNavigationProvider } from "./components/AppShell";
import { RouteTransition } from "./components/RouteTransition";
import { SwipeRouteViewport } from "./components/SwipeRouteViewport";
import type { VisualDataAdapter } from "./data/visual-adapter";
import { useInteractionFeedback } from "./hooks/useInteractionFeedback";
import { useBrowserRoute } from "./hooks/useBrowserRoute";
import { RouteSkeletonTimingProvider } from "./motion/skeleton-hold";
import { isTaskPageAlias, matchRoute, showsPrimaryNav } from "./router";
import { HomePage } from "./pages/HomePage";
import { TaskHomePage } from "./pages/TaskHomePage";

const TemplatesPage = lazy(() => import("./pages/TemplatesPage").then(({ TemplatesPage: page }) => ({ default: page })));
const CreatePage = lazy(() => import("./pages/CreatePage").then(({ CreatePage: page }) => ({ default: page })));
const ProductionEditPage = lazy(() => import("./pages/ProductionEditPage").then(({ ProductionEditPage: page }) => ({ default: page })));
const ReplicaWizardPage = lazy(() => import("./pages/ReplicaWizardPage").then(({ ReplicaWizardPage: page }) => ({ default: page })));
const ObservationReportPage = lazy(() => import("./pages/ObservationReportPage").then(({ ObservationReportPage: page }) => ({ default: page })));
const ObservationStartPage = lazy(() => import("./pages/ObservationStartPage").then(({ ObservationStartPage: page }) => ({ default: page })));
const TaskPage = lazy(() => import("./pages/TaskPage").then(({ TaskPage: page }) => ({ default: page })));
const AiSettingsPage = lazy(() => import("./pages/AiSettingsPage").then(({ AiSettingsPage: page }) => ({ default: page })));
const StorageAnalysisPage = lazy(() => import("./pages/StorageAnalysisPage").then(({ StorageAnalysisPage: page }) => ({ default: page })));
const StorageAreaPage = lazy(() => import("./pages/StorageAreaPage").then(({ StorageAreaPage: page }) => ({ default: page })));
const ApplicationInfoPage = lazy(() => import("./pages/ApplicationInfoPage").then(({ ApplicationInfoPage: page }) => ({ default: page })));
const UpdateLogPage = lazy(() => import("./pages/UpdateLogPage").then(({ UpdateLogPage: page }) => ({ default: page })));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage").then(({ ProfileSettingsPage: page }) => ({ default: page })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(({ SettingsPage: page }) => ({ default: page })));
const PlaybookPage = lazy(() => import("./playbook/PlaybookPage").then(({ PlaybookPage: page }) => ({ default: page })));

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
  const { pathname, direction, transitionMode, navigate, searchEpoch } = useBrowserRoute();
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
    if (renderedRoute.key === "settings-storage") {
      return runtime
        ? <StorageAnalysisPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="本地存储暂时无法读取，请重新打开应用。" navigate={navigate} title="存储管理暂时不可用" />;
    }
    if (renderedRoute.key === "settings-storage-area") {
      const area = renderedRoute.params.area;
      return runtime && area
        ? <StorageAreaPage area={area} key={area} navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="本地存储暂时无法读取，请重新打开应用。" navigate={navigate} title="存储管理暂时不可用" />;
    }
    if (renderedRoute.key === "settings-app-info") {
      return runtime
        ? <ApplicationInfoPage navigate={navigate} runtime={runtime} />
        : <RuntimePendingPage description="版本信息暂时无法读取，请重新打开应用。" navigate={navigate} title="应用信息暂时不可用" />;
    }
    if (renderedRoute.key === "settings-update-log") {
      return <UpdateLogPage navigate={navigate} />;
    }
    if (runtime && renderedRoute.key === "home") return <TaskHomePage navigate={navigate} runtime={runtime} searchEpoch={searchEpoch} />;
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
      return <CreatePage navigate={navigate} runtime={runtime} searchEpoch={searchEpoch} />;
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

    if (renderedRoute.key === "playbook") {
      return <PlaybookPage navigate={navigate} sectionId={renderedRoute.params.sectionId} />;
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
  const showPrimaryNav = showsPrimaryNav(route.key);

  return (
    <AppShellNavigationProvider>
      <SwipeRouteViewport active={showPrimaryNav ? activeNav : undefined} currentPath={pathname} navigate={navigate}>
        <RouteTransition direction={direction} pathname={pathname} transitionMode={transitionMode}>
          <RouteSkeletonTimingProvider>
            <Suspense fallback={<PageSkeleton path={pathname} />}>{renderRoute(pathname)}</Suspense>
          </RouteSkeletonTimingProvider>
        </RouteTransition>
      </SwipeRouteViewport>
      {showPrimaryNav ? <BottomNav active={activeNav} navigate={navigate} /> : null}
    </AppShellNavigationProvider>
  );
}
