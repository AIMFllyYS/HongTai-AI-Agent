import { resolveTemplateForPrecision, subtitleTimingPrecision, TaskError } from "@hongtai/core";

import type { ProductionPlanningAsset } from "../../contracts/production-planning";
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

function normalizedCopy(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[^\p{Letter}\p{Number}]/gu, "");
}

/** Rejects plans that lift twelve or more consecutive characters straight from the reference copy. */
export function assertOriginalNarration(plan: ProductionPlanResult, constraints: ProductionPlanConstraints): void {
  if (constraints.mode !== "montage" || !constraints.originalSourceText) return;
  const original = normalizedCopy(constraints.originalSourceText);
  const narration = normalizedCopy(plan.shots.map((shot) => shot.narration).join(""));
  if (original.length < 12 || narration.length < 12) return;
  for (let index = 0; index <= narration.length - 12; index += 1) {
    if (original.includes(narration.slice(index, index + 12))) {
      throw invalidPlan("制作口播与参考原文存在连续重复，请重新组织原创表达");
    }
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
 * The single place that decides whether a production plan is executable. Both the planning flow
 * and any later partial edit run these rules, so an edited plan can never be looser than a
 * generated one.
 */
export function validateProductionPlan(plan: ProductionPlanResult, constraints: ProductionPlanConstraints): void {
  if (plan.source.analysisTaskId !== constraints.analysisTaskId) throw invalidPlan("制作计划来源与真实拆解任务不一致");
  if (plan.settings.durationSeconds !== constraints.targetDurationSeconds) throw invalidPlan("制作计划时长与目标时长不一致");
  if (plan.shots.some((shot, index) => shot.order !== index + 1)) throw invalidPlan("制作计划镜头顺序不连续");
  const total = plan.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  if (Math.abs(total - plan.settings.durationSeconds) > 0.01) throw invalidPlan("制作计划镜头总时长不一致");

  const assets = new Map(constraints.assets.map((asset) => [asset.id, asset]));
  if (plan.shots.some((shot) => !assets.has(shot.assetId))) throw invalidPlan("制作计划引用了不存在的素材");
  const musicId = plan.audio.backgroundMusicAssetId;
  if (musicId !== null && assets.get(musicId)?.kind !== "audio") throw invalidPlan("背景音乐必须引用已导入的音频素材");
  if (musicId === null && plan.audio.backgroundMusicVolume !== 0) throw invalidPlan("没有背景音乐时音量必须为0");

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
  }

  assertOriginalNarration(plan, constraints);

  if (constraints.mode === "avatar") {
    const avatarId = constraints.assets.find((asset) => asset.role === "avatar")?.id;
    if (!avatarId || plan.shots.some((shot) => shot.assetId !== avatarId)) throw invalidPlan("数字人口播计划只能使用上传的数字人视频");
    if (musicId !== null || plan.audio.backgroundMusicVolume !== 0) throw invalidPlan("数字人口播模式保留原视频声音，不能叠加背景音乐");
  }
}
