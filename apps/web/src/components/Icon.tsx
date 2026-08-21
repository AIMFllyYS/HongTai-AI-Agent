import type { SVGProps } from "react";

import { playbookGlyphs, spinningIconNames, type IconName } from "../playbook/icon-catalog";

export type { IconName };

const spinningNames = new Set<string>(spinningIconNames);

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "ref"> {
  readonly name: IconName;
  readonly size?: number;
  readonly label?: string;
}

export function Icon({ name, size = 22, label, className, ...props }: IconProps) {
  const Glyph = playbookGlyphs[name];
  const spinning = spinningNames.has(name);
  return (
    <Glyph
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={["playbook-icon", spinning ? "playbook-icon--spin" : "", className].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      size={size}
      strokeWidth={2}
    />
  );
}
