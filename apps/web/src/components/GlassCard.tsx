import type { HTMLAttributes, PropsWithChildren } from "react";

export interface GlassCardProps extends PropsWithChildren<HTMLAttributes<HTMLElement>> {
  readonly as?: "article" | "div" | "section";
  readonly tone?: "card" | "soft" | "glass";
}

export function GlassCard({ as = "article", tone = "card", className = "", children, ...props }: GlassCardProps) {
  const Component = as;
  return <Component className={`glass-card glass-card--${tone} ${className}`.trim()} {...props}>{children}</Component>;
}
