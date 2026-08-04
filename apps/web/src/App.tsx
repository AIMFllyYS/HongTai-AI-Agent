import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/StatePanels";
import { useBrowserRoute } from "./hooks/useBrowserRoute";
import { matchRoute } from "./router";

export function App() {
  const { pathname, navigate } = useBrowserRoute();
  const route = matchRoute(pathname);
  return (
    <AppShell activeNav={route.key === "not-found" ? undefined : route.navKey} navigate={navigate} title="宏泰AI智能体">
      <section className="page-section">
        <EmptyState description={`已匹配 route：${route.path}`} title="共享视觉壳已就绪" />
      </section>
    </AppShell>
  );
}
