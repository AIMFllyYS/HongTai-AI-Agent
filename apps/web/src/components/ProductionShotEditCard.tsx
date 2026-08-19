import { useId } from "react";

import {
  MAX_SHOT_MS,
  MIN_SHOT_MS,
  SHOT_STEP_MS,
  shotDurationBounds,
  type ShotDraft,
} from "../features/production/plan-edit-model";
import type { PlanShotView } from "../features/production/production-plan-view";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import { StepperField } from "./StepperField";
import { SubtitleTemplatePreview } from "./SubtitleTemplatePreview";

export interface ProductionShotEditCardProps {
  readonly draft: ShotDraft;
  readonly shot: PlanShotView;
  readonly shots: readonly ShotDraft[];
  readonly totalMilliseconds: number;
  readonly templateId: string;
  readonly hasWordTiming: boolean;
  readonly shortCues: number;
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
  draft, shot, shots, totalMilliseconds, templateId, hasWordTiming, shortCues, lockedCopy, disabled,
  onDuration, onNarration, onCaption,
}: ProductionShotEditCardProps) {
  const narrationId = useId();
  const captionId = useId();
  const bounds = shotDurationBounds({ shots, order: draft.order, totalMilliseconds });
  const single = shots.length < 2;
  const first = shot.cues[0];

  return (
    <GlassCard className="shot-edit-card" tone="soft">
      <header className="shot-edit-card__head">
        <em>{String(draft.order).padStart(2, "0")}</em>
        <div>
          <strong>{draft.caption || "这个镜头还没有标题"}</strong>
          <small>{shot.cues.length > 0 ? `${shot.cues.length} 条字幕` : "还没有切出字幕"}</small>
        </div>
      </header>

      {/* Previews the first real cue. A plan made before subtitle timing existed has none, and
          slicing the narration would show a caption the export never puts on screen. */}
      {first ? (
        <div className="shot-edit-card__stage">
          <SubtitleTemplatePreview
            emphasisWords={first.emphasisWords}
            hasWordTiming={hasWordTiming}
            placement="band"
            templateId={templateId}
            text={first.text}
          />
        </div>
      ) : (
        <p className="production-hint">
          <Icon name="info" size={16} />
          这个计划还没有字幕时间轴。保存微调后会按当前文案和模板重新切分，届时可以在这里预览。
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
        // Absorbing another shot's change lands on any millisecond, not just the button's step.
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

      {shortCues > 0 ? (
        <p className="shot-edit-card__warning" role="status">
          <Icon name="error" size={16} />
          有 {shortCues} 条字幕短于 0.6 秒，观众来不及看完。加长这个镜头，或把口播改短一些。
        </p>
      ) : null}

      {shot.cues.length > 0 ? (
        <details className="shot-edit-card__cues">
          <summary>看这个镜头切出的字幕</summary>
          <ol>
            {shot.cues.map((cue) => (
              <li key={cue.startMs}>
                <code>{(cue.startMs / 1_000).toFixed(1)}–{(cue.endMs / 1_000).toFixed(1)}s</code>
                <span>{cue.text}</span>
              </li>
            ))}
          </ol>
          <p>字幕的切分和进出点由文案与模板决定，保存后会重新计算，不能在这里逐条拖动。</p>
        </details>
      ) : null}
    </GlassCard>
  );
}
