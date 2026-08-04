import type { PropsWithChildren, ReactNode } from "react";
import { BottomNav, type BottomNavProps } from "./BottomNav";
import { Icon } from "./Icon";

export interface AppShellProps extends PropsWithChildren {
  readonly title: string;
  readonly subtitle?: string;
  readonly navigate: (path: string) => void;
  readonly backPath?: string;
  readonly activeNav?: BottomNavProps["active"];
  readonly showNav?: boolean;
  readonly headerAction?: ReactNode;
  readonly contextualAction?: ReactNode;
  readonly className?: string;
}

export function AppShell({ title, subtitle, navigate, backPath, activeNav, showNav = true, headerAction, contextualAction, className = "", children }: AppShellProps) {
  const back = () => navigate(backPath ?? "/");
  return (
    <div className={`app-shell ${showNav ? "app-shell--with-nav" : ""} ${className}`.trim()}>
      <header className={`app-header ${backPath ? "app-header--detail" : ""}`.trim()}>
        {backPath ? <button aria-label="返回" className="icon-button" onClick={back} type="button"><Icon name="arrow_back" size={25} /></button> : <span className="brand-mark"><Icon name="robot" size={25} /></span>}
        <div className="app-header__title-wrap">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {headerAction ?? <button aria-label="通知" className="icon-button" type="button"><Icon name="notifications" size={24} /></button>}
      </header>
      <main className="app-content">{children}</main>
      {contextualAction ? <div className="contextual-action">{contextualAction}</div> : null}
      {showNav ? <BottomNav active={activeNav} navigate={navigate} /> : null}
    </div>
  );
}
