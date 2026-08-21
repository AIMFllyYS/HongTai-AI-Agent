import type { FormEvent, Ref } from "react";

import { Icon } from "../../components/Icon";

export const OBSERVATION_FOLLOW_UP_PAGE_INPUT_ID = "observation-follow-up";
export const OBSERVATION_FOLLOW_UP_SHEET_INPUT_ID = "observation-follow-up-sheet";

export interface ObservationFollowUpComposerProps {
  readonly id: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onChange: (value: string) => void;
  readonly onFocus?: () => void;
  readonly onSubmit: () => void;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function ObservationFollowUpComposer({
  id,
  value,
  placeholder,
  disabled,
  pending,
  onChange,
  onFocus,
  onSubmit,
  inputRef,
}: ObservationFollowUpComposerProps) {
  const canSend = !disabled && !pending && value.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) onSubmit();
  };

  return (
    <form className="observation-follow-up-composer" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={id}>追问内容</label>
      <input
        autoComplete="off"
        disabled={disabled || pending}
        id={id}
        maxLength={20_000}
        ref={inputRef}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      <button
        aria-label={pending ? "正在回复" : "发送追问"}
        className={pending ? "observation-follow-up-composer__send is-busy" : "observation-follow-up-composer__send"}
        disabled={!canSend}
        type="submit"
      >
        <Icon name={pending ? "loader_circle" : "arrow_up"} size={16} />
      </button>
    </form>
  );
}
