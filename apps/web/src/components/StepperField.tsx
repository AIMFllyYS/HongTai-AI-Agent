import { useId } from "react";

import { Icon } from "./Icon";

export interface StepperFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** How far one button press moves. */
  readonly step: number;
  /**
   * Smallest value the slider can land on. Defaults to `step`, but a caller whose value is adjusted
   * off the step grid must widen this: a range input snaps to its own grid, and the thumb would then
   * sit at a different number than the one displayed.
   */
  readonly sliderStep?: number;
  readonly onChange: (value: number) => void;
  /** Rendered next to the label; the raw number is rarely what the user needs to read. */
  readonly format: (value: number) => string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

/**
 * A slider paired with decrement/increment buttons. Dragging is fast but imprecise on a phone, and
 * the buttons are the only way to land on an exact value with a thumb, so both are always present.
 */
export function StepperField({ label, value, min, max, step, sliderStep, onChange, format, hint, disabled = false }: StepperFieldProps) {
  const id = useId();
  const locked = disabled || max <= min;
  const move = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    if (next !== value) onChange(next);
  };

  return (
    <div className="stepper-field">
      <div className="stepper-field__head">
        <label className="field-label" htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <div className="stepper-field__controls">
        <button
          aria-label={`减少${label}`}
          className="stepper-field__button"
          disabled={locked || value <= min}
          onClick={() => move(-1)}
          type="button"
        >
          <Icon name="remove" size={18} />
        </button>
        <input
          aria-valuetext={format(value)}
          disabled={locked}
          id={id}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={sliderStep ?? step}
          type="range"
          value={value}
        />
        <button
          aria-label={`增加${label}`}
          className="stepper-field__button"
          disabled={locked || value >= max}
          onClick={() => move(1)}
          type="button"
        >
          <Icon name="add" size={18} />
        </button>
      </div>
      {hint ? <p className="stepper-field__hint">{hint}</p> : null}
    </div>
  );
}
