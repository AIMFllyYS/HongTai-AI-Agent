import { EmptyState } from "./components/StatePanels";
import { activeNavForRoute } from "./components/BottomNav";
import { AppShell } from "./components/AppShell";
import { createStaticVisualDataAdapter } from "./data/static-visual-adapter";
import type { VisualDataAdapter } from "./data/visual-adapter";
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
  const { pathname, navigate } = useBrowserRoute();
  const route = matchRoute(pathname);
  const visualData = injectedVisualData ?? createStaticVisualDataAdapter();

  if (route.key === "home") return <HomePage navigate={navigate} viewModel={visualData.getHome()} />;
  if (route.key === "processing") return <ProcessingPage navigate={navigate} viewModel={visualData.getProcessing()} />;
  if (route.key === "analysis-result") return <AnalysisResultPage navigate={navigate} viewModel={visualData.getAnalysisResult()} />;
  if (route.key === "video-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("video")} />;
  if (route.key === "gallery-detail") return <DetailPage navigate={navigate} viewModel={visualData.getDetail("gallery")} />;
  if (route.key === "create") return <CreatePage navigate={navigate} viewModel={visualData.getCreate()} />;
  if (route.key === "publish") return <PublishPage navigate={navigate} viewModel={visualData.getPublish()} />;
  if (route.key === "assets") return <AssetsPage navigate={navigate} viewModel={visualData.getAssets()} />;
  if (route.key === "settings") return <SettingsPage navigate={navigate} viewModel={visualData.getSettings()} />;
  if (route.key === "vitality-scan") return <VitalityScanPage navigate={navigate} viewModel={visualData.getVitalityScan()} />;
  if (route.key === "vitality-result") return <VitalityResultPage navigate={navigate} viewModel={visualData.getVitalityResult()} />;

  return (
    <AppShell activeNav={activeNavForRoute(route.key)} navigate={navigate} title="宏泰AI智能体">
      <EmptyState action={<button className="button button--primary" onClick={() => navigate("/")} type="button">返回首页</button>} description={`没有找到页面：${route.path}`} title="页面不存在" />
    </AppShell>
  );
}
