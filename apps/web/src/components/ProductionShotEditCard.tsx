import { useId } from "react";

import {
  MAX_SHOT_MS,
  MIN_SHOT_MS,
  SHOT_STEP_MS,
  shotDurationBounds,
  type ShotDraft,
  type ShotPreview,
} from "../features/production/plan-edit-model";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import { StepperField } from "./StepperField";
import { SubtitleTemplatePreview } from "./SubtitleTemplatePreview";

export interface ProductionShotEditCardProps {
  readonly draft: ShotDraft;
  /** What saving would produce for this shot, so the card never shows the previous save's timings. */
  readonly preview: ShotPreview;
  readonly shots: readonly ShotDraft[];
  readonly totalMilliseconds: number;
  /** Avatar captions come from the recorded voice, so the service refuses these two fields. */
  readonly lockedCopy: boolean;
  readonly disabled: boolean;
  readonly onDuration: (milliseconds: number) => void;
  readonly onNarration: (value: string) => void;
  readonly onCaption: (value: string) => void;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)} 秒`;
}

export function ProductionShotEditCard({
  draft, preview, shots, totalMilliseconds, lockedCopy, disabled,
  onDuration, onNarration, onCaption,
}: ProductionShotEditCardProps) {
  const narrationId = useId();
  const captionId = useId();
  const bounds = shotDurationBounds({ shots, order: draft.order, totalMilliseconds });
  const single = shots.length < 2;
  const first = preview.cues[0];

  return (
    <GlassCard className="shot-edit-card" tone="soft">
      <header className="shot-edit-card__head">
        <em>{String(draft.order).padStart(2, "0")}</em>
        <div>
          <strong>{draft.caption || "这个镜头还没有标题"}</strong>
          <small>{preview.cues.length > 0 ? `${preview.cues.length} 条字幕` : "切不出字幕"}</small>
        </div>
      </header>

      {first ? (
        <div className="shot-edit-card__stage">
          <SubtitleTemplatePreview
            emphasisWords={first.emphasisWords}
            // An edit re-derives cues from the copy, so it can never claim per-word timing.
            hasWordTiming={false}
            placement="band"
            templateId={preview.templateId}
            text={first.text}
          />
        </div>
      ) : (
        <p className="production-hint">
          <Icon name="info" size={16} />
          这个镜头没有口播文案，切不出字幕。填上文案后这里会显示它在画面上的样子。
        </p>
      )}

      <StepperField
        disabled={disabled || single}
        format={seconds}
        hint={single
          ? "只有一个镜头时，时长跟着项目总时长走。"
          : lockedCopy
            ? "数字人口播按原视频顺序切片，时长不能单独调整。"
            : `可调 ${seconds(bounds.minMs)} 到 ${seconds(bounds.maxMs)}，其余镜头会按比例补回差值。`}
        label={`第 ${draft.order} 镜时长`}
        max={lockedCopy ? draft.milliseconds : Math.min(bounds.maxMs, MAX_SHOT_MS)}
        min={lockedCopy ? draft.milliseconds : Math.max(bounds.minMs, MIN_SHOT_MS)}
        onChange={onDuration}
        // The slider positions itself on the exact value: an older plan can hold 6.667 s, which the
        // button's step cannot express, and snapping the thumb would misreport what is stored.
        sliderStep={1}
        step={SHOT_STEP_MS}
        value={draft.milliseconds}
      />

      <div className="shot-edit-card__field">
        <label className="field-label" htmlFor={captionId}>镜头标题</label>
        <input
          disabled={disabled}
          id={captionId}
          maxLength={40}
          onChange={(event) => onCaption(event.target.value)}
          required
          type="text"
          value={draft.caption}
        />
      </div>

      <div className="shot-edit-card__field">
        <label className="field-label" htmlFor={narrationId}>口播文案</label>
        <textarea
          disabled={disabled || lockedCopy}
          id={narrationId}
          maxLength={160}
          onChange={(event) => onNarration(event.target.value)}
          required
          rows={3}
          value={draft.narration}
        />
        <small className="shot-edit-card__count">{[...draft.narration].length}/160</small>
      </div>

      {lockedCopy ? (
        <p className="production-hint">
          <Icon name="info" size={16} />
          字幕就是数字人视频里说出的话。改这里会让字幕和原声对不上，所以请改口播稿后重新生成计划。
        </p>
      ) : null}

      {preview.shortCues > 0 ? (
        <p className="shot-edit-card__warning" role="status">
          <Icon name="error" size={16} />
          有 {preview.shortCues} 条字幕短于 0.6 秒，观众来不及看完。加长这个镜头，或把口播改短一些。
        </p>
      ) : null}

      {preview.cues.length > 0 ? (
        <details className="shot-edit-card__cues">
          <summary>看这个镜头切出的字幕</summary>
          <ol>
            {preview.cues.map((cue) => (
              <li key={cue.startMs}>
                <code>{(cue.startMs / 1_000).toFixed(1)}–{(cue.endMs / 1_000).toFixed(1)}s</code>
                <span>{cue.text}</span>
              </li>
            ))}
          </ol>
          <p>这就是保存后会烧进画面的切分：由文案、时长和模板一起决定，不能在这里逐条拖动。</p>
        </details>
      ) : null}
    </GlassCard>
  );
}
