import {
  buildShotCueTimeline,
  resolveTemplateForPrecision,
  subtitleTimingPrecision,
  type SubtitleTimingSource,
  type TaskError,
} from "@hongtai/core";

import {
  productionPlanResultV3Schema,
  type ProductionPlanGrounding,
  type ProductionPlanResultV2,
  type ProductionPlanResultV3,
} from "../../schemas/production-plan";

export interface SubtitleTimelineInput {
  /** A plan carrying every v2 field; the subtitle timeline is derived from its shots. */
  readonly plan: ProductionPlanResultV2;
  /** Evidence behind the cue boundaries, which decides the precision the plan may claim. */
  readonly source: SubtitleTimingSource;
  /** Template the user picked; degraded automatically when it needs word-level timing. */
  readonly requestedTemplateId?: string;
  /**
   * How this run matched narration to material. Omitted by an edit, which reuses whatever the plan
   * already recorded: rewriting a caption does not make the planner have seen the pictures, and it
   * does not un-see them either.
   */
  readonly grounding?: ProductionPlanGrounding;
  /** How this caller reports a plan it cannot make executable, since recovery differs per mode. */
  readonly invalid: (cause: unknown) => TaskError;
}

/**
 * Turns a v2-shaped plan into a validated v3 plan by deriving each shot's cue timeline.
 *
 * Cue milliseconds are computed here rather than asked of a language model, which produces
 * plausible numbers that do not add up. The result is parsed against its own schema before it
 * is returned: a plan that fails the schema would still persist, and the project could no
 * longer be opened afterwards.
 */
export function withSubtitleTimeline(input: SubtitleTimelineInput): ProductionPlanResultV3 {
  const precision = subtitleTimingPrecision(input.source);
  const resolved = resolveTemplateForPrecision({ requestedId: input.requestedTemplateId ?? "", precision });
  const derived = {
    ...input.plan,
    schemaVersion: "production-plan.v3",
    subtitle: {
      templateId: resolved.template.id,
      timing: { precision, source: input.source },
      degradedFromTemplateId: resolved.degradedFrom ?? null,
    },
    shots: input.plan.shots.map((shot) => ({
      ...shot,
      cues: buildShotCueTimeline({
        text: shot.narration,
        shotDurationMs: Math.round(shot.durationSeconds * 1_000),
        typography: resolved.template.typography,
      }).map((cue) => ({ ...cue, emphasisWords: [...cue.emphasisWords] })),
    })),
    decorations: [],
    ...(input.grounding === undefined ? {} : { grounding: input.grounding }),
  };

  const parsed = productionPlanResultV3Schema.safeParse(derived);
  if (!parsed.success) throw input.invalid(parsed.error);
  return parsed.data;
}
