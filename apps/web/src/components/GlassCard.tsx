import type { HTMLAttributes, KeyboardEvent, PropsWithChildren } from "react";

export interface GlassCardProps extends PropsWithChildren<HTMLAttributes<HTMLElement>> {
  readonly as?: "article" | "div" | "section";
  readonly tone?: "card" | "soft" | "glass";
}

export function GlassCard({ as = "article", tone = "card", className = "", children, onClick, onKeyDown, role, tabIndex, ...props }: GlassCardProps) {
  const Component = as;
  const interactive = typeof onClick === "function";
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (!interactive || event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.currentTarget.click();
  };

  return (
    <Component
      {...props}
      className={`glass-card glass-card--${tone} ${interactive ? "glass-card--interactive" : ""} ${className}`.trim()}
      data-feedback={interactive ? "press" : undefined}
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
      role={interactive ? role ?? "button" : role}
      tabIndex={interactive ? tabIndex ?? 0 : tabIndex}
    >
      {children}
    </Component>
  );
}
