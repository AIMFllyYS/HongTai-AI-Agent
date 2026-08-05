import type { PropsWithChildren, ReactNode } from "react";
import { BottomNav, type BottomNavProps } from "./BottomNav";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";

export type AppShellVisualTheme = "workbench" | "warm-soft-tech";

export interface AppShellProps extends PropsWithChildren {
  readonly title: string;
  readonly subtitle?: string;
  readonly navigate: (path: string) => void;
  readonly backPath?: string;
  readonly activeNav?: BottomNavProps["active"];
  readonly showNav?: boolean;
  readonly visualTheme?: AppShellVisualTheme;
  readonly headerMode?: "brand" | "detail";
  readonly leadingAction?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly contextualAction?: ReactNode;
  readonly className?: string;
}

export function AppShell({ title, subtitle, navigate, backPath, activeNav, showNav = true, visualTheme = "workbench", headerMode, leadingAction, headerAction, contextualAction, className = "", children }: AppShellProps) {
  const back = () => navigate(backPath ?? "/");
  const isDetailHeader = headerMode === "detail" || Boolean(backPath);
  const leading = leadingAction ?? (backPath ? <button aria-label="返回" className="icon-button" onClick={back} type="button"><Icon name="arrow_back" size={25} /></button> : <BrandLogo />);

  return (
    <div className={`app-shell ${showNav ? "app-shell--with-nav" : ""} ${className}`.trim()} data-visual-theme={visualTheme}>
      <header className={`app-header ${isDetailHeader ? "app-header--detail" : ""}`.trim()}>
        {leading}
        <div className="app-header__title-wrap">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="app-header__action">{headerAction ?? <button aria-label="通知" className="icon-button" type="button"><Icon name="notifications" size={24} /></button>}</div>
      </header>
      <main className="app-content">{children}</main>
      {contextualAction ? <div className="contextual-action">{contextualAction}</div> : null}
      {showNav ? <BottomNav active={activeNav} navigate={navigate} /> : null}
    </div>
  );
}
