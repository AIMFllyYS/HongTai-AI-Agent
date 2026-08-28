import {
  MAX_CUES_PER_SHOT,
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_PRODUCTION_DURATION_SECONDS,
  MIN_SHOT_DURATION_SECONDS,
} from "@hongtai/core";
import { z } from "zod";

import { toProviderJsonSchema } from "../structured-output/json-schema";
import {
  decorationSelectionSchema,
  MAX_MEASURED_SHOT_MS,
  measuredProductionDecorationSchema,
  measuredProductionSubtitleSettingsSchema,
  measuredSubtitleCueSchema,
  productionDecorationSchema,
  productionSubtitleSettingsSchema,
  subtitleCueSchema,
} from "./production-plan-overlays";

const productionShotBaseSchema = z.object({
  order: z.number().int().positive(),
  assetId: z.string().min(1),
  durationSeconds: z.number().min(MIN_SHOT_DURATION_SECONDS).max(MAX_SHOT_DURATION_SECONDS),
  narration: z.string().min(1).max(160),
  caption: z.string().min(1).max(40),
  fit: z.enum(["cover", "contain"]),
});

const productionPlanBaseSchema = z.object({
  source: z.object({ analysisTaskId: z.string().min(1) }),
  title: z.string().min(1).max(80),
  settings: z.object({
    width: z.literal(720),
    height: z.literal(1280),
    fps: z.literal(30),
    durationSeconds: z.number().min(MIN_PRODUCTION_DURATION_SECONDS).max(MAX_PRODUCTION_DURATION_SECONDS),
  }),
  audio: z.object({
    voiceLocale: z.literal("zh-CN"),
    speechRate: z.number().min(0.75).max(1.25),
    backgroundMusicAssetId: z.string().min(1).nullable(),
    backgroundMusicVolume: z.number().min(0).max(0.35),
  }),
  shots: z.array(productionShotBaseSchema).min(1).max(MAX_SHOTS_PER_PRODUCTION),
});

/**
 * Whether the planner had seen the material when it wrote this narration.
 *
 * Derived from the run, never asked of the model: a plan that could claim its own grounding would
 * claim the flattering value. `blind` is the honest label for matching narration to filenames and
 * durations, which is all the planner ever had before asset insight existed.
 */
export const PRODUCTION_VISUAL_GROUNDINGS = [
  "asset_insight",
  "blind",
  /** Avatar mode: the words are the user's own script over their own recording, so nothing is matched. */
  "not_applicable",
] as const;

const productionGroundingSchema = z.object({
  visual: z.enum(PRODUCTION_VISUAL_GROUNDINGS),
  /** Assets whose real frames were described. Empty unless `visual` is `asset_insight`. */
  describedAssetIds: z.array(z.string().min(1)).max(MAX_SHOTS_PER_PRODUCTION),
});

const textOverlaySchema = z.object({
  primaryText: z.string().min(1).max(24),
  secondaryText: z.string().min(1).max(32).nullable(),
  preset: z.enum(["classic_top", "clean_card", "aqua_accent"]),
});

export const productionPlanResultV1Schema = productionPlanBaseSchema.extend({
  schemaVersion: z.literal("production-plan.v1"),
});

export const productionPlanResultV2Schema = productionPlanBaseSchema.extend({
  schemaVersion: z.literal("production-plan.v2"),
  textOverlay: textOverlaySchema,
});

/**
 * v3 keeps every v2 field and adds the subtitle template reference, a per-shot caption
 * timeline and a bounded decoration layer. Cue and decoration timestamps are relative to the
 * shot that owns them, so a shot can be re-timed without rewriting the whole plan.
 */
export const productionPlanResultV3Schema = productionPlanBaseSchema.extend({
  schemaVersion: z.literal("production-plan.v3"),
  textOverlay: textOverlaySchema,
  subtitle: productionSubtitleSettingsSchema,
  shots: z.array(productionShotBaseSchema.extend({
    cues: z.array(subtitleCueSchema).min(1).max(MAX_CUES_PER_SHOT),
  })).min(1).max(MAX_SHOTS_PER_PRODUCTION),
  decorations: z.array(productionDecorationSchema).max(6),
  /**
   * Optional so plans written before asset insight existed still parse. Those runs had no vision at
   * all, so a reader may treat an absent record as `blind` — refusing to open them instead would
   * take away projects the user already made.
   */
  grounding: productionGroundingSchema.optional(),
});

/**
 * v4 数字人镜头的源视频窗口：把单段预处理数字人视频确定性裁剪/拼接成该镜头画面的映射，
 * 由共享层 `planAvatarSourceWindows`（core）烘焙进计划，模型从不经手这些毫秒数。缺省表示
 * 走旧路径（无窗口计划）；窗口毫秒为整数且 `endMs` 严格大于 `startMs`。上限按「最长单镜
 * 60 秒 ÷ 最短源视频 2 秒」推导。
 */
export const MAX_SOURCE_WINDOWS_PER_SHOT = 30;

const sourceWindowSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
  })
  .refine((window) => window.endMs > window.startMs);

/**
 * v4（文稿先行）的镜头：时长来自本镜口播句的实测 TTS 音频（`TtsTimedTrack.durationMs`），
 * 没有目标时长。`sentenceId` 把镜头对回分镜脚本里的那句话（`ScriptSentence.id`），回改
 * 文案、重新配音与重新渲染都以它定位受影响的句子。
 */
const measuredProductionShotSchema = productionShotBaseSchema.omit({ durationSeconds: true }).extend({
  /** 实测 TTS 音频时长（毫秒）。渲染、总时长与字幕铺排都以它为准，不用字符估算。 */
  durationMs: z.number().int().positive().max(MAX_MEASURED_SHOT_MS),
  sentenceId: z.string().min(1),
  cues: z.array(measuredSubtitleCueSchema).min(1).max(MAX_CUES_PER_SHOT),
  /** 数字人窗口（可选）：窗口时长之和恒等于该镜头 `durationMs`，由规划器保证。 */
  sourceWindows: z.array(sourceWindowSchema).min(1).max(MAX_SOURCE_WINDOWS_PER_SHOT).optional(),
});

/**
 * v4（文稿先行）：由分镜脚本（`ScriptStoryboard`）与实测 TTS 音轨（`TtsTimedTrack`）在本地
 * 组装，模型不再直出任何时长或时间戳。与 v3 的两点刻意差异：
 *
 * - 没有目标时长字段：v3 的 `settings.durationSeconds` 是预设目标且镜头总和必须精确等于
 *   它；v4 的总时长是 Σ `shots[].durationMs` 的派生值，由界面求和展示，不再持久化第二
 *   份副本——保留副本只会招致漂移，而且软边界计划（总时长出界、用户确认后继续）必须
 *   可持久化，硬性 min/max 也不能放进 Schema。
 * - `source.analysisTaskId` 允许 null：v4 起参考拆解是可选增强，null 如实表示「本次没有
 *   参考拆解」。
 *
 * grounding、贴纸与字幕样式沿用 v3 字段惯例；`subtitle.timing` 的来源被限制为实测
 * （`asr_word` / `tts_duration`）。
 */
export const productionPlanResultV4Schema = productionPlanBaseSchema.extend({
  schemaVersion: z.literal("production-plan.v4"),
  source: z.object({ analysisTaskId: z.string().min(1).nullable() }),
  settings: productionPlanBaseSchema.shape.settings.omit({ durationSeconds: true }),
  textOverlay: textOverlaySchema,
  subtitle: measuredProductionSubtitleSettingsSchema,
  shots: z.array(measuredProductionShotSchema).min(1).max(MAX_SHOTS_PER_PRODUCTION),
  decorations: z.array(measuredProductionDecorationSchema).max(6),
  grounding: productionGroundingSchema.optional(),
});

export const productionPlanResultSchema = z.union([
  productionPlanResultV1Schema,
  productionPlanResultV2Schema,
  productionPlanResultV3Schema,
  productionPlanResultV4Schema,
]);

export type ProductionPlanGrounding = z.infer<typeof productionGroundingSchema>;
export type ProductionPlanResultV1 = z.infer<typeof productionPlanResultV1Schema>;
export type ProductionPlanResultV2 = z.infer<typeof productionPlanResultV2Schema>;
export type ProductionPlanResultV3 = z.infer<typeof productionPlanResultV3Schema>;
export type ProductionPlanResultV4 = z.infer<typeof productionPlanResultV4Schema>;
export type ProductionPlanResult = z.infer<typeof productionPlanResultSchema>;
/** v1–v3 历史计划：仍走 `validateProductionPlan`，v4 走 `validateMeasuredProductionPlan`。 */
export type LegacyProductionPlanResult = Exclude<ProductionPlanResult, ProductionPlanResultV4>;

/**
 * Planner JSON is still a v2 plan plus decoration *choices*. Cue milliseconds for those stickers
 * are assembled locally after the subtitle timeline exists; the model is not asked to invent them.
 */
export const productionPlannerOutputSchema = productionPlanResultV2Schema.extend({
  decorationSelections: z.array(decorationSelectionSchema).max(6),
});

export type ProductionPlannerOutput = z.infer<typeof productionPlannerOutputSchema>;

export const productionPlanResultJsonSchema = toProviderJsonSchema(productionPlannerOutputSchema);
export const productionPlanResultV3JsonSchema = toProviderJsonSchema(productionPlanResultV3Schema);
