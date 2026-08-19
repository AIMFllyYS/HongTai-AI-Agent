import { resolveTemplateForPrecision, subtitleTimingPrecision, TaskError } from "@hongtai/core";

import type { ProductionPlanningAsset } from "../../contracts/production-planning";
import { sharesVerbatimRun } from "../../originality";
import { MAX_DECORATIONS_PER_PLAN, MAX_DECORATIONS_PER_SHOT } from "../../schemas/production-plan-overlays";
import type { ProductionPlanResult, ProductionPlanResultV3 } from "../../schemas/production-plan";

/** A cue may finish this many milliseconds past its shot to absorb encoder rounding. */
const CUE_TAIL_TOLERANCE_MS = 60;

export interface ProductionPlanConstraints {
  readonly analysisTaskId: string;
  readonly mode: "montage" | "avatar";
  readonly targetDurationSeconds: number;
  readonly textPreset: "classic_top" | "clean_card" | "aqua_accent";
  readonly headlineText?: string;
  /** Subtitle template the user picked; a v3 plan must match it exactly. */
  readonly subtitleTemplateId?: string;
  /** Decoration manifest ids that may be referenced. Anything outside this list is rejected. */
  readonly allowedDecorationIds?: readonly string[];
  readonly assets: readonly ProductionPlanningAsset[];
  /** Reference copy used only to reject verbatim reuse; omit to skip that check. */
  readonly originalSourceText?: string;
}

export function invalidPlan(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

/** True when the duration survives the renderer's millisecond arithmetic without rounding. */
export function isWholeMilliseconds(seconds: number): boolean {
  const milliseconds = seconds * 1_000;
  return Math.abs(milliseconds - Math.round(milliseconds)) < 1e-6;
}

/** Rejects plans that lift twelve or more consecutive characters straight from the reference copy. */
export function assertOriginalNarration(plan: ProductionPlanResult, constraints: ProductionPlanConstraints): void {
  if (constraints.mode !== "montage" || !constraints.originalSourceText) return;
  const narration = plan.shots.map((shot) => shot.narration).join("");
  if (sharesVerbatimRun(narration, constraints.originalSourceText)) {
    throw invalidPlan("制作口播与参考原文存在连续重复，请重新组织原创表达");
  }
}

/**
 * Keeps the promised subtitle look in step with the evidence behind the cue times. The
 * renderer trusts `templateId` as-is, so the degrade has to be settled and recorded here
 * rather than re-decided at render time.
 */
function validateSubtitleTiming(plan: ProductionPlanResultV3, constraints: ProductionPlanConstraints): void {
  const { templateId, timing, degradedFromTemplateId } = plan.subtitle;
  const requestedId = degradedFromTemplateId ?? templateId;
  if (constraints.subtitleTemplateId && requestedId !== constraints.subtitleTemplateId) {
    throw invalidPlan("制作计划字幕模板与用户选择不一致");
  }
  if (subtitleTimingPrecision(timing.source) !== timing.precision) throw invalidPlan("字幕时间精度与时间来源不一致");

  const resolved = resolveTemplateForPrecision({ requestedId, precision: timing.precision });
  if (resolved.template.id !== templateId) throw invalidPlan("字幕模板降级结果与时间精度不匹配");
  if ((resolved.degradedFrom ?? null) !== degradedFromTemplateId) throw invalidPlan("字幕模板降级标识与实际降级不一致");

  if (timing.precision === "word" && plan.shots.some((shot) => shot.cues.some((cue) => cue.words === null))) {
    throw invalidPlan("声明词级精度时每条字幕都必须带词级时间");
  }
}

function validateCues(plan: ProductionPlanResultV3): void {
  for (const shot of plan.shots) {
    // A shot without cues renders as a silent gap and is rejected by both the plan schema and
    // the Android parser, so it must never reach persistence.
    if (shot.cues.length === 0) throw invalidPlan("每个镜头都必须有至少一条字幕");
    const shotEndMs = Math.round(shot.durationSeconds * 1000) + CUE_TAIL_TOLERANCE_MS;
    let previousEndMs = -1;
    for (const cue of shot.cues) {
      if (cue.endMs <= cue.startMs) throw invalidPlan("字幕起止时间必须是正区间");
      if (cue.startMs < previousEndMs) throw invalidPlan("同一镜头内的字幕不能重叠或倒序");
      if (cue.endMs > shotEndMs) throw invalidPlan("字幕结束时间超出所属镜头时长");
      for (const word of cue.emphasisWords) {
        if (!cue.text.includes(word)) throw invalidPlan("强调词必须出现在该条字幕文本中");
      }
      validateCueWords(cue);
      previousEndMs = cue.endMs;
    }
  }
}

function validateCueWords(cue: ProductionPlanResultV3["shots"][number]["cues"][number]): void {
  if (!cue.words) return;
  let previousEndMs = cue.startMs;
  for (const word of cue.words) {
    if (word.endMs <= word.startMs) throw invalidPlan("词级时间必须是正区间");
    if (word.startMs < cue.startMs || word.endMs > cue.endMs) throw invalidPlan("词级时间必须落在所属字幕区间内");
    if (word.startMs < previousEndMs) throw invalidPlan("词级时间不能重叠或倒序");
    previousEndMs = word.endMs;
  }
  const joined = cue.words.map((word) => word.text).join("").replace(/\s+/gu, "");
  if (joined !== cue.text.replace(/\s+/gu, "")) throw invalidPlan("词级时间拼接后必须与字幕文本一致");
}

function validateDecorations(plan: ProductionPlanResultV3, constraints: ProductionPlanConstraints): void {
  if (plan.decorations.length > MAX_DECORATIONS_PER_PLAN) throw invalidPlan("装饰数量超出单条视频上限");
  const allowed = new Set(constraints.allowedDecorationIds ?? []);
  const shots = new Map(plan.shots.map((shot) => [shot.order, shot]));
  const perShot = new Map<number, number>();

  for (const decoration of plan.decorations) {
    const shot = shots.get(decoration.shotOrder);
    if (!shot) throw invalidPlan("装饰引用了不存在的镜头");
    const used = (perShot.get(decoration.shotOrder) ?? 0) + 1;
    if (used > MAX_DECORATIONS_PER_SHOT) throw invalidPlan("单个镜头的装饰数量超出上限");
    perShot.set(decoration.shotOrder, used);

    if (decoration.endMs <= decoration.startMs) throw invalidPlan("装饰起止时间必须是正区间");
    if (decoration.endMs > Math.round(shot.durationSeconds * 1000) + CUE_TAIL_TOLERANCE_MS) {
      throw invalidPlan("装饰结束时间超出所属镜头时长");
    }
    if (decoration.kind === "sticker") {
      if (!decoration.assetRef || decoration.text !== null) throw invalidPlan("贴纸装饰必须引用素材清单且不带文字");
      if (!allowed.has(decoration.assetRef)) throw invalidPlan("装饰引用了不在内置素材清单中的资源");
    } else if (!decoration.text || decoration.assetRef !== null) {
      throw invalidPlan("浮动文字装饰必须给出文字且不引用素材清单");
    }
  }
}

/**
 * Keeps the record of "did the planner see the material" internally consistent.
 *
 * The field is derived rather than model-authored, so this guards a coding mistake instead of a
 * lying model — but it is the field the export screen uses to tell the user their video was matched
 * blind, and a wrong value there is worse than no field at all.
 */
function validateGrounding(plan: ProductionPlanResultV3, constraints: ProductionPlanConstraints): void {
  const grounding = plan.grounding;
  if (!grounding) return;
  const described = grounding.describedAssetIds;
  if (grounding.visual === "asset_insight") {
    if (described.length === 0) throw invalidPlan("声明已识别画面时必须列出被识别的素材");
  } else if (described.length > 0) {
    throw invalidPlan("未识别画面时不能列出被识别的素材");
  }
  if (new Set(described).size !== described.length) throw invalidPlan("被识别的素材不能重复");
  const known = new Set(constraints.assets.map((asset) => asset.id));
  if (described.some((assetId) => !known.has(assetId))) throw invalidPlan("被识别的素材必须是本项目已导入的素材");
  if (constraints.mode === "avatar" && grounding.visual !== "not_applicable") {
    throw invalidPlan("数字人口播模式的字幕来自用户口播稿，不应声明画面识别状态");
  }
}

/**
 * Keeps the finished video in the order the user filmed for.
 *
 * When assets arrive from a replica blueprint, each one was shot for a numbered item on a list the
 * user worked through. Letting the planner reorder them would quietly turn that list into a
 * suggestion, so the shots must be exactly the bound assets, in the list's own order. Items the user
 * skipped simply are not here; the ones that remain keep their relative order.
 */
function validateRequirementOrder(plan: ProductionPlanResult, constraints: ProductionPlanConstraints): void {
  const bound = constraints.assets
    .filter((asset) => asset.requirement !== undefined)
    .sort((left, right) => (left.requirement?.order ?? 0) - (right.requirement?.order ?? 0));
  if (bound.length === 0) return;
  if (plan.shots.length !== bound.length) throw invalidPlan("制作计划镜头数量必须与已绑定的素材清单项一致");
  for (const [index, asset] of bound.entries()) {
    if (plan.shots[index]?.assetId !== asset.id) throw invalidPlan("制作计划镜头必须按素材清单的顺序使用对应素材");
  }
}

/**
 * The single place that decides whether a production plan is executable. Both the planning flow
 * and any later partial edit run these rules, so an edited plan can never be looser than a
 * generated one.
 */
export function validateProductionPlan(plan: ProductionPlanResult, constraints: ProductionPlanConstraints): void {
  if (plan.source.analysisTaskId !== constraints.analysisTaskId) throw invalidPlan("制作计划来源与真实拆解任务不一致");
  if (plan.settings.durationSeconds !== constraints.targetDurationSeconds) throw invalidPlan("制作计划时长与目标时长不一致");
  if (plan.shots.some((shot, index) => shot.order !== index + 1)) throw invalidPlan("制作计划镜头顺序不连续");
  // The renderer works in whole milliseconds and requires the shots to sum exactly. A duration it
  // cannot express would otherwise only surface as a failed render after the user waits for it.
  if (plan.shots.some((shot) => !isWholeMilliseconds(shot.durationSeconds))) {
    throw invalidPlan("制作计划镜头时长必须精确到毫秒");
  }
  const totalMs = plan.shots.reduce((sum, shot) => sum + Math.round(shot.durationSeconds * 1_000), 0);
  if (totalMs !== Math.round(plan.settings.durationSeconds * 1_000)) throw invalidPlan("制作计划镜头总时长不一致");

  const assets = new Map(constraints.assets.map((asset) => [asset.id, asset]));
  if (plan.shots.some((shot) => !assets.has(shot.assetId))) throw invalidPlan("制作计划引用了不存在的素材");
  if (plan.shots.some((shot) => assets.get(shot.assetId)?.kind === "audio")) throw invalidPlan("镜头画面不能引用音频素材");
  const musicId = plan.audio.backgroundMusicAssetId;
  if (musicId !== null && assets.get(musicId)?.kind !== "audio") throw invalidPlan("背景音乐必须引用已导入的音频素材");
  if (musicId === null && plan.audio.backgroundMusicVolume !== 0) throw invalidPlan("没有背景音乐时音量必须为0");
  // Music at zero volume renders as silence while the plan still lists a track, which reads as a
  // broken export rather than a deliberate choice.
  if (musicId !== null && plan.audio.backgroundMusicVolume <= 0) throw invalidPlan("选择了背景音乐时音量必须大于0");

  if (plan.schemaVersion !== "production-plan.v1") {
    if (plan.textOverlay.preset !== constraints.textPreset) throw invalidPlan("制作计划文字预设与用户选择不一致");
    if (constraints.headlineText && plan.textOverlay.primaryText !== constraints.headlineText.trim()) {
      throw invalidPlan("制作计划没有逐字使用用户填写的主文字");
    }
  }

  if (plan.schemaVersion === "production-plan.v3") {
    validateSubtitleTiming(plan, constraints);
    validateCues(plan);
    validateDecorations(plan, constraints);
    validateGrounding(plan, constraints);
  }

  validateRequirementOrder(plan, constraints);
  assertOriginalNarration(plan, constraints);

  if (constraints.mode === "avatar") {
    const avatarId = constraints.assets.find((asset) => asset.role === "avatar")?.id;
    if (!avatarId || plan.shots.some((shot) => shot.assetId !== avatarId)) throw invalidPlan("数字人口播计划只能使用上传的数字人视频");
    if (musicId !== null || plan.audio.backgroundMusicVolume !== 0) throw invalidPlan("数字人口播模式保留原视频声音，不能叠加背景音乐");
  }
}
