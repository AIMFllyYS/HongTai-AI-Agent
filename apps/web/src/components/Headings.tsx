import type { ReactNode } from "react";

export interface PageHeadingProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function PageHeading({ eyebrow, title, description, action, className = "" }: PageHeadingProps) {
  return (
    <div className={`page-heading ${className}`.trim()}>
      <div>
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </div>
  );
}

export interface SectionHeadingProps {
  readonly title: string;
  readonly leading?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function SectionHeading({ title, leading, action, className = "" }: SectionHeadingProps) {
  return (
    <div className={`section-heading ${className}`.trim()}>
      <h3>{leading}{title}</h3>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
