export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly labelledBy?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function Switch({ checked, onChange, labelledBy, disabled, className }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-labelledby={labelledBy}
      className={["switch", checked ? "is-on" : "", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="switch__thumb" />
    </button>
  );
}
