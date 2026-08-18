import { resolveSubtitleTemplate, SUBTITLE_TEMPLATES, subtitleTemplateById, type SubtitleTemplateId } from "@hongtai/core";

import { SubtitleTemplatePreview } from "./SubtitleTemplatePreview";

/** Neutral synthetic caption: no store data, no health claim, safe for screenshots. */
const SAMPLE_TEXT = "开场三秒先说结论，别绕弯子";
const SAMPLE_EMPHASIS = ["三秒", "结论"] as const;

export interface SubtitleTemplatePickerProps {
  readonly value: string;
  readonly onChange: (templateId: SubtitleTemplateId) => void;
  /** Pass false when word-level timing is unavailable so the degrade notice is honest. */
  readonly hasWordTiming?: boolean;
  readonly disabled?: boolean;
  readonly labelId?: string;
}

/** Live style swatches for the built-in subtitle templates, rendered from the shared contract. */
export function SubtitleTemplatePicker({ value, onChange, hasWordTiming, disabled = false, labelId }: SubtitleTemplatePickerProps) {
  const selected = resolveSubtitleTemplate({ id: value, hasWordTiming });

  return (
    <div aria-labelledby={labelId} className="subtitle-template-picker" role="radiogroup">
      {SUBTITLE_TEMPLATES.map((template) => {
        const active = template.id === value;
        return (
          <button
            aria-checked={active}
            className={active ? "subtitle-template-option is-selected" : "subtitle-template-option"}
            disabled={disabled}
            key={template.id}
            onClick={() => onChange(template.id)}
            role="radio"
            type="button"
          >
            <span className="subtitle-template-option__stage">
              <SubtitleTemplatePreview
                emphasisWords={SAMPLE_EMPHASIS}
                hasWordTiming={hasWordTiming}
                placement="band"
                templateId={template.id}
                text={SAMPLE_TEXT}
              />
            </span>
            <span className="subtitle-template-option__head">
              <span className="subtitle-template-option__name">{template.name}</span>
              {template.requiresWordTiming ? <span className="subtitle-template-option__summary">需要词级时间</span> : null}
            </span>
            <span className="subtitle-template-option__summary">{template.summary}</span>
          </button>
        );
      })}
      {selected.degradedFrom ? (
        <p className="subtitle-template-notice">
          这条视频还没有词级时间，「{subtitleTemplateById(selected.degradedFrom).name}」会按「{selected.template.name}」呈现，不会伪造逐字对齐。
        </p>
      ) : null}
    </div>
  );
}
