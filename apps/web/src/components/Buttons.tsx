import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export interface ButtonProps extends PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> {
  readonly variant?: "primary" | "secondary" | "ghost" | "quiet";
  readonly size?: "md" | "lg";
  readonly icon?: React.ReactNode;
}

export function Button({ variant = "primary", size = "md", icon, className = "", children, ...props }: ButtonProps) {
  return <button className={`button button--${variant} button--${size} ${className}`.trim()} type="button" {...props}>{icon}{children}</button>;
}

export interface LinkButtonProps extends PropsWithChildren<React.AnchorHTMLAttributes<HTMLAnchorElement>> {
  readonly variant?: "primary" | "secondary" | "ghost" | "quiet";
  readonly size?: "md" | "lg";
  readonly icon?: React.ReactNode;
}

export function LinkButton({ variant = "primary", size = "md", icon, className = "", children, ...props }: LinkButtonProps) {
  return <a className={`button button--${variant} button--${size} ${className}`.trim()} {...props}>{icon}{children}</a>;
}
