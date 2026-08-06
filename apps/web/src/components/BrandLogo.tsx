export interface BrandLogoProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly variant?: "mark" | "icon" | "lockup";
}

export function BrandLogo({ size = "md", className = "", variant = "mark" }: BrandLogoProps) {
  const source = variant === "mark" ? "/brand/pulse-flow-mark.png" : "/brand/pulse-flow-source.png";

  return <span className={`brand-logo brand-logo--${size} brand-logo--${variant} ${className}`.trim()}><img alt="宏泰AI智能体 Pulse Flow" src={source} /></span>;
}
