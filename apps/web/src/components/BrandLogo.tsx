export interface BrandLogoProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly variant?: "icon" | "lockup";
}

export function BrandLogo({ size = "md", className = "", variant = "icon" }: BrandLogoProps) {
  const source = variant === "lockup" ? "/brand/pulse-flow.svg" : "/brand/pulse-flow-icon.svg";

  return <span className={`brand-logo brand-logo--${size} brand-logo--${variant} ${className}`.trim()}><img alt="宏泰AI智能体 Pulse Flow" src={source} /></span>;
}
