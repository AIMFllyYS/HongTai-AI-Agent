import logoSource from "../assets/brand-logo.png";

export interface BrandLogoProps {
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function BrandLogo({ size = "md", className = "" }: BrandLogoProps) {
  return (
    <span className={`brand-logo brand-logo--${size} ${className}`.trim()}>
      <img alt="宏泰AI智能体" src={logoSource} />
    </span>
  );
}
