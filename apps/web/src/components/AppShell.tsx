import { createContext, useContext } from "react";
import type { PropsWithChildren, ReactNode } from "react";
import { BottomNav, type BottomNavProps } from "./BottomNav";
import { Icon } from "./Icon";
import { useScrollMotion } from "../hooks/useScrollMotion";
import type { Navigate, RouteKey } from "../router";

export type AppShellVisualTheme = "workbench" | "warm-soft-tech";

export function visualThemeForRoute(routeKey: RouteKey): AppShellVisualTheme {
  return routeKey === "observation-new" || routeKey === "observation-report" ? "warm-soft-tech" : "workbench";
}

const externalNavigationContext = createContext(false);

export function AppShellNavigationProvider({ children }: PropsWithChildren) {
  return <externalNavigationContext.Provider value={true}>{children}</externalNavigationContext.Provider>;
}

export interface AppShellProps extends PropsWithChildren {
  readonly title: string;
  readonly subtitle?: string;
  readonly navigate: Navigate;
  readonly backPath?: string;
  readonly activeNav?: BottomNavProps["active"];
  readonly showNav?: boolean;
  readonly visualTheme?: AppShellVisualTheme;
  readonly headerMode?: "large" | "detail" | "hidden";
  readonly leadingAction?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly contextualAction?: ReactNode;
  readonly className?: string;
}

export function AppShell({
  title,
  subtitle,
  navigate,
  backPath,
  activeNav,
  showNav = true,
  visualTheme = "workbench",
  headerMode,
  leadingAction,
  headerAction,
  contextualAction,
  className = "",
  children,
}: AppShellProps) {
  const back = () => navigate(backPath ?? "/");
  const isDetailHeader = headerMode === "detail" || Boolean(backPath);
  const hideHeader = headerMode === "hidden";
  const leading = leadingAction ?? (backPath
    ? <button aria-label="返回" className="icon-button" onClick={back} type="button"><Icon name="chevron_left" size={24} /></button>
    : null);
  const scrollState = useScrollMotion();
  const hasExternalNavigation = useContext(externalNavigationContext);
  const shellMode = hideHeader ? "hidden" : isDetailHeader ? "detail" : "large";

  return (
    <div className={`app-shell ${showNav ? "app-shell--with-nav" : ""} app-shell--${shellMode} ${className}`.trim()} data-scroll-state={scrollState} data-visual-theme={visualTheme}>
      {isDetailHeader && !hideHeader ? (
        <header className="app-header app-header--detail">
          {leading ?? <span className="app-header__slot" />}
          <div className="app-header__title-wrap">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="app-header__action">{headerAction}</div>
        </header>
      ) : null}
      <main className="app-content">
        {!isDetailHeader && !hideHeader ? (
          <header className="page-masthead">
            <div className="page-masthead__titles">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {(headerAction || leadingAction) ? <div className="page-masthead__action">{headerAction ?? leadingAction}</div> : null}
          </header>
        ) : null}
        {children}
      </main>
      {contextualAction ? <div className="contextual-action">{contextualAction}</div> : null}
      {showNav && !hasExternalNavigation ? <BottomNav active={activeNav} navigate={navigate} /> : null}
    </div>
  );
}
