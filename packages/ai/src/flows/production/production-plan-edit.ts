import { TaskError, type ProductionPlanUpdate, type ProductionShotUpdate } from "@hongtai/core";

import type { ProductionPlanResult, ProductionPlanResultV2, ProductionPlanResultV3 } from "../../schemas/production-plan";
import { isWholeMilliseconds, validateProductionPlan, type ProductionPlanConstraints } from "./production-plan-validation";
import { withSubtitleTimeline } from "./production-subtitle-timeline";

/**
 * An edit re-derives cue boundaries from the narration, so the result is only ever as honest as
 * a character-weighted estimate. Claiming a measured tier after a manual edit would be a lie
 * even when the plan being edited was measured.
 */
const EDIT_TIMING_SOURCE = "script_estimate" as const;

export function invalidEdit(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "PRODUCTION_PLAN_EDIT_INVALID", message, action: "edit_input", cause });
}

/** The template the plan was asked for, which is what a later degrade has to be re-derived from. */
export function requestedSubtitleTemplateId(plan: ProductionPlanResult): string | undefined {
  if (plan.schemaVersion !== "production-plan.v3") return undefined;
  return plan.subtitle.degradedFromTemplateId ?? plan.subtitle.templateId;
}

/**
 * Strips the derived subtitle layer so the timeline can be rebuilt from scratch. Keeping the old
 * cues would let an edited narration keep timings that no longer match its own text.
 */
function editableBase(plan: ProductionPlanResult): ProductionPlanResultV2 {
  if (plan.schemaVersion === "production-plan.v1") {
    throw invalidEdit("这个制作计划太旧，缺少字幕与文字信息，请重新生成后再微调。");
  }
  const shots = plan.shots.map((shot) => ({
    order: shot.order,
    assetId: shot.assetId,
    durationSeconds: shot.durationSeconds,
    narration: shot.narration,
    caption: shot.caption,
    fit: shot.fit,
  }));
  return { ...plan, schemaVersion: "production-plan.v2", shots };
}

function editedShot(shot: ProductionPlanResultV2["shots"][number], edit: ProductionShotUpdate) {
  const narration = edit.narration?.trim();
  const caption = edit.caption?.trim();
  if (edit.narration !== undefined && !narration) throw invalidEdit(`第 ${shot.order} 个镜头的口播内容不能为空。`);
  if (edit.caption !== undefined && !caption) throw invalidEdit(`第 ${shot.order} 个镜头的标题不能为空。`);
  if (edit.durationSeconds !== undefined && !isWholeMilliseconds(edit.durationSeconds)) {
    throw invalidEdit(`第 ${shot.order} 个镜头的时长需要精确到毫秒。`);
  }
  return {
    ...shot,
    ...(edit.assetId === undefined ? {} : { assetId: edit.assetId }),
    ...(edit.durationSeconds === undefined ? {} : { durationSeconds: edit.durationSeconds }),
    ...(narration === undefined ? {} : { narration }),
    ...(caption === undefined ? {} : { caption }),
  };
}

function withEditedShots(
  shots: ProductionPlanResultV2["shots"],
  edits: readonly ProductionShotUpdate[],
): ProductionPlanResultV2["shots"] {
  const seen = new Set<number>();
  for (const edit of edits) {
    if (!shots.some((shot) => shot.order === edit.order)) throw invalidEdit(`制作计划里没有第 ${edit.order} 个镜头。`);
    if (seen.has(edit.order)) throw invalidEdit(`第 ${edit.order} 个镜头被重复修改，请合并后再提交。`);
    seen.add(edit.order);
  }
  return shots.map((shot) => {
    const edit = edits.find((candidate) => candidate.order === shot.order);
    return edit ? editedShot(shot, edit) : shot;
  });
}

/**
 * Reports the target total in the message, because the caller cannot fix a duration edit without
 * knowing how much time the remaining shots have to give back.
 */
function assertShotDurationsFillPlan(plan: ProductionPlanResultV2): void {
  const totalMs = plan.shots.reduce((sum, shot) => sum + Math.round(shot.durationSeconds * 1_000), 0);
  const targetMs = Math.round(plan.settings.durationSeconds * 1_000);
  if (totalMs === targetMs) return;
  const difference = (totalMs - targetMs) / 1_000;
  throw invalidEdit(
    difference > 0
      ? `镜头总时长比目标多 ${difference.toFixed(3)} 秒，请把多出的时间从其他镜头里减掉。`
      : `镜头总时长比目标少 ${Math.abs(difference).toFixed(3)} 秒，请把剩余时间分配到其他镜头。`,
  );
}

export interface ProductionPlanEditInput {
  readonly plan: ProductionPlanResult;
  readonly edit: ProductionPlanUpdate;
  /** Built from the project, so an edit can never loosen what generation had to satisfy. */
  readonly constraints: ProductionPlanConstraints;
}

/**
 * Applies a bounded edit and returns a plan that has passed the same executability gate as a
 * generated one. Everything is validated before anything is returned, so the caller never has a
 * half-applied plan to persist.
 */
export function applyProductionPlanEdit(input: ProductionPlanEditInput): ProductionPlanResultV3 {
  const { edit } = input;
  const base = editableBase(input.plan);
  const headline = edit.headlineText?.trim();
  if (edit.headlineText !== undefined && !headline) throw invalidEdit("主文字不能为空，删除请留空原文字预设。");

  const music = edit.backgroundMusicAssetId;
  const edited: ProductionPlanResultV2 = {
    ...base,
    audio: {
      ...base.audio,
      ...(edit.speechRate === undefined ? {} : { speechRate: edit.speechRate }),
      ...(music === undefined ? {} : { backgroundMusicAssetId: music }),
      ...(edit.backgroundMusicVolume === undefined ? {} : { backgroundMusicVolume: edit.backgroundMusicVolume }),
      ...(music === null ? { backgroundMusicVolume: 0 } : {}),
    },
    textOverlay: { ...base.textOverlay, ...(headline === undefined ? {} : { primaryText: headline }) },
    shots: edit.shots ? withEditedShots(base.shots, edit.shots) : base.shots,
  };
  assertShotDurationsFillPlan(edited);

  const requestedTemplateId = edit.subtitleTemplateId ?? requestedSubtitleTemplateId(input.plan);
  const next = withSubtitleTimeline({
    plan: edited,
    source: EDIT_TIMING_SOURCE,
    ...(requestedTemplateId === undefined ? {} : { requestedTemplateId }),
    invalid: (cause) => invalidEdit("这次微调无法生成可播放的字幕，请检查镜头文案和时长。", cause),
  });
  validateProductionPlan(next, input.constraints);
  return next;
}
