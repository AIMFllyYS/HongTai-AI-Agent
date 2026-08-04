import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export interface ButtonProps extends PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> {
  readonly variant?: "primary" | "secondary" | "ghost" | "quiet";
  readonly icon?: React.ReactNode;
}

export function Button({ variant = "primary", icon, className = "", children, ...props }: ButtonProps) {
  return <button className={`button button--${variant} ${className}`.trim()} type="button" {...props}>{icon}{children}</button>;
}

export interface LinkButtonProps extends PropsWithChildren<React.AnchorHTMLAttributes<HTMLAnchorElement>> {
  readonly variant?: "primary" | "secondary" | "ghost" | "quiet";
  readonly icon?: React.ReactNode;
}

export function LinkButton({ variant = "primary", icon, className = "", children, ...props }: LinkButtonProps) {
  return <a className={`button button--${variant} ${className}`.trim()} {...props}>{icon}{children}</a>;
}
