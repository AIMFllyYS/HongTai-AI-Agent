import type { RouteKey } from "../router";
import { matchRoute } from "../router";

export type PageSkeletonLayout =
  | "home"
  | "home-list"
  | "observation"
  | "observation-list"
  | "templates"
  | "templates-list"
  | "settings"
  | "task"
  | "report"
  | "create"
  | "generic";

export function pageSkeletonLayoutForRoute(key: RouteKey): PageSkeletonLayout {
  if (key === "home") return "home";
  if (key === "observation-new") return "observation";
  if (key === "templates") return "templates";
  if (key === "settings" || key === "settings-profile" || key === "settings-ai" || key === "settings-storage" || key === "settings-app-info" || key === "settings-update-log") return "settings";
  if (key === "task-processing" || key === "task-detail" || key === "task-analysis") return "task";
  if (key === "observation-report") return "report";
  if (key === "create" || key === "production-edit" || key === "replica-wizard") return "create";
  return "generic";
}

export function pageSkeletonLayoutForPath(path: string): PageSkeletonLayout {
  return pageSkeletonLayoutForRoute(matchRoute(path).key);
}

function Bars({ widths }: { readonly widths: readonly string[] }) {
  return (
    <div className="page-skeleton__stack" aria-hidden="true">
      {widths.map((width, index) => (
        <span className="page-skeleton__block" key={`${width}-${index}`} style={{ width }} />
      ))}
    </div>
  );
}

function Rows({ count, className = "page-skeleton__row" }: { readonly count: number; readonly className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className={className} key={index} aria-hidden="true">
          <span className="page-skeleton__block page-skeleton__block--thumb" />
          <Bars widths={["72%", "44%"]} />
        </div>
      ))}
    </>
  );
}

function SkeletonBody({ layout }: { readonly layout: PageSkeletonLayout }) {
  if (layout === "home-list" || layout === "observation-list") {
    return <Rows count={layout === "home-list" ? 3 : 2} />;
  }
  if (layout === "templates-list") {
    return (
      <>
        <div className="page-skeleton__carousel" aria-hidden="true">
          <span className="page-skeleton__block page-skeleton__block--card" />
          <span className="page-skeleton__block page-skeleton__block--card" />
        </div>
        <Rows count={3} />
      </>
    );
  }
  if (layout === "home") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--segment" aria-hidden="true" />
        <span className="page-skeleton__block page-skeleton__block--field" aria-hidden="true" />
        <span className="page-skeleton__block page-skeleton__block--button" aria-hidden="true" />
        <Rows count={3} />
      </>
    );
  }
  if (layout === "observation") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--segment" aria-hidden="true" />
        <span className="page-skeleton__block page-skeleton__block--hero" aria-hidden="true" />
        <Rows count={2} className="page-skeleton__row page-skeleton__row--card" />
      </>
    );
  }
  if (layout === "templates") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--field" aria-hidden="true" />
        <div className="page-skeleton__carousel" aria-hidden="true">
          <span className="page-skeleton__block page-skeleton__block--card" />
          <span className="page-skeleton__block page-skeleton__block--card" />
        </div>
        <Rows count={3} />
      </>
    );
  }
  if (layout === "settings") {
    return (
      <>
        <div className="page-skeleton__row page-skeleton__row--profile" aria-hidden="true">
          <span className="page-skeleton__block page-skeleton__block--avatar" />
          <Bars widths={["48%", "28%"]} />
        </div>
        <Rows count={5} />
      </>
    );
  }
  if (layout === "task") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--media" aria-hidden="true" />
        <span className="page-skeleton__block page-skeleton__block--segment" aria-hidden="true" />
        <Bars widths={["92%", "78%", "64%", "54%"]} />
      </>
    );
  }
  if (layout === "report") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--hero" aria-hidden="true" />
        <Rows count={5} />
      </>
    );
  }
  if (layout === "create") {
    return (
      <>
        <span className="page-skeleton__block page-skeleton__block--stage" aria-hidden="true" />
        <Rows count={3} />
      </>
    );
  }
  return <Bars widths={["76%", "62%", "48%"]} />;
}

export interface PageSkeletonProps {
  readonly path?: string;
  readonly layout?: PageSkeletonLayout;
}

export function PageSkeleton({ path, layout }: PageSkeletonProps) {
  const resolved = layout ?? (path ? pageSkeletonLayoutForPath(path) : "generic");
  const framed = Boolean(path);

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={framed ? "app-shell app-shell--with-nav page-skeleton page-skeleton--framed" : "page-skeleton"}
      data-skeleton-layout={resolved}
    >
      <span className="visually-hidden">正在打开页面</span>
      {framed ? (
        <div className="page-skeleton__masthead" aria-hidden="true">
          <span className="page-skeleton__block page-skeleton__block--title" />
          <span className="page-skeleton__block page-skeleton__block--caption" />
        </div>
      ) : null}
      <SkeletonBody layout={resolved} />
    </div>
  );
}
