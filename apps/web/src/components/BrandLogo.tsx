export interface BrandLogoProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly variant?: "mark" | "icon" | "lockup";
}

export function BrandLogo({ size = "md", className = "", variant = "mark" }: BrandLogoProps) {
  const source = variant === "lockup" ? "/brand/pulse-flow.svg" : variant === "icon" ? "/brand/pulse-flow-icon.svg" : "/brand/pulse-flow-mark.svg";

  return <span className={`brand-logo brand-logo--${size} brand-logo--${variant} ${className}`.trim()}><img alt="宏泰AI智能体 Pulse Flow" src={source} /></span>;
}
