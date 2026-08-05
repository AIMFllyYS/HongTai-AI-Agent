import { EmptyState } from "./components/StatePanels";
import { activeNavForRoute, BottomNav } from "./components/BottomNav";
import { AppShell, AppShellNavigationProvider } from "./components/AppShell";
import { RouteTransition } from "./components/RouteTransition";
import { SwipeRouteViewport } from "./components/SwipeRouteViewport";
import { createStaticVisualDataAdapter } from "./data/static-visual-adapter";
import type { VisualDataAdapter } from "./data/visual-adapter";
import { useInteractionFeedback } from "./hooks/useInteractionFeedback";
import { useBrowserRoute } from "./hooks/useBrowserRoute";
import { matchRoute } from "./router";
import { AnalysisResultPage } from "./pages/AnalysisResultPage";
import { AssetsPage } from "./pages/AssetsPage";
import { CreatePage } from "./pages/CreatePage";
import { DetailPage } from "./pages/DetailPage";
import { HomePage } from "./pages/HomePage";
import { ProcessingPage } from "./pages/ProcessingPage";
import { PublishPage } from "./pages/PublishPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VitalityResultPage } from "./pages/VitalityResultPage";
import { VitalityScanPage } from "./pages/VitalityScanPage";

export interface AppProps {
  readonly visualData?: VisualDataAdapter;
}

export function App({ visualData: injectedVisualData }: AppProps = {}) {
  const { pathname, direction, transitionMode, navigate } = useBrowserRoute();
  useInteractionFeedback();
  const visualData = injectedVisualData ?? createStaticVisualDataAdapter();

  const renderRoute = (path: string) => {
    const renderedRoute = matchRoute(path);
    if (renderedRoute.key === "home") return <HomePage navigate={navigate} viewModel={visualData.getHome()} />;
    if (renderedRoute.key === "processing") return <ProcessingPage navigate={navigate} viewModel={visualData.getProcessing()} />;
    if (renderedRoute.key === "analysis-result") return <AnalysisResultPage navigate={navigate} viewModel={visualData.getAnalysisResult()} />;
    if (renderedRoute.key === "video-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("video")} />;
    if (renderedRoute.key === "gallery-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("gallery")} />;
    if (renderedRoute.key === "create") return <CreatePage navigate={navigate} viewModel={visualData.getCreate()} />;
    if (renderedRoute.key === "publish") return <PublishPage navigate={navigate} viewModel={visualData.getPublish()} />;
    if (renderedRoute.key === "assets") return <AssetsPage navigate={navigate} viewModel={visualData.getAssets()} />;
    if (renderedRoute.key === "settings") return <SettingsPage navigate={navigate} viewModel={visualData.getSettings()} />;
    if (renderedRoute.key === "vitality-scan") return <VitalityScanPage navigate={navigate} viewModel={visualData.getVitalityScan()} />;
    if (renderedRoute.key === "vitality-result") return <VitalityResultPage navigate={navigate} viewModel={visualData.getVitalityResult()} />;

    return (
      <AppShell activeNav={activeNavForRoute(renderedRoute.key)} navigate={navigate} title="宏泰AI智能体">
        <EmptyState action={<button className="button button--primary" onClick={() => navigate("/")} type="button">返回首页</button>} description={`没有找到页面：${renderedRoute.path}`} title="页面不存在" />
      </AppShell>
    );
  };

  const route = matchRoute(pathname);
  const activeNav = activeNavForRoute(route.key);
  const visualTheme = route.key === "vitality-scan" || route.key === "vitality-result" ? "warm-soft-tech" : "workbench";

  return (
    <AppShellNavigationProvider>
      <SwipeRouteViewport active={activeNav} currentPath={pathname} navigate={navigate} renderRoute={renderRoute}>
        <RouteTransition direction={direction} pathname={pathname} transitionMode={transitionMode}>{renderRoute(pathname)}</RouteTransition>
      </SwipeRouteViewport>
      <BottomNav active={activeNav} navigate={navigate} visualTheme={visualTheme} />
    </AppShellNavigationProvider>
  );
}
