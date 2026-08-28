import {
  DECORATION_ANCHORS,
  DECORATION_ANIMATIONS,
  DECORATION_IDS,
  MAX_CUE_CHARACTERS,
  MAX_EMPHASIS_WORD_CHARACTERS,
  MAX_EMPHASIS_WORDS_PER_CUE,
  MAX_PRODUCTION_DURATION_SECONDS,
  SUBTITLE_TIMING_PRECISIONS,
  SUBTITLE_TIMING_SOURCES,
} from "@hongtai/core";
import { z } from "zod";

import { subtitleTemplateIdSchema } from "./subtitle-template";

/** Longest single shot allowed by the plan, used to bound every shot-relative timestamp. */
export const MAX_SHOT_MS = 20_000;

/**
 * v4 实测路径的镜头相对时间戳上限。v3 把单镜硬上限 20 秒同时用作时间戳上限；v4 的单镜
 * 超 20 秒与总时长超 60 秒都是软违规（用户确认后可继续渲染），时间戳上限因此放宽到总时长
 * 软上限 60 秒——再长的单镜连确认路径也不支持，应回改文稿。
 */
export const MAX_MEASURED_SHOT_MS = MAX_PRODUCTION_DURATION_SECONDS * 1_000;

export const DECORATION_KINDS = ["sticker", "floating_text"] as const;

export { DECORATION_ANCHORS, DECORATION_ANIMATIONS };

/** At most this many decorations per shot and per plan, so a video never turns into a sticker wall. */
export const MAX_DECORATIONS_PER_SHOT = 2;
export const MAX_DECORATIONS_PER_PLAN = 6;

const shotTimestampMs = z.number().int().min(0).max(MAX_SHOT_MS);

export const subtitleCueWordSchema = z.object({
  text: z.string().min(1).max(24),
  startMs: shotTimestampMs,
  endMs: shotTimestampMs,
});

export const subtitleCueSchema = z.object({
  /** Milliseconds relative to the start of the owning shot. */
  startMs: shotTimestampMs,
  endMs: shotTimestampMs,
  text: z.string().min(1).max(MAX_CUE_CHARACTERS),
  /** Words the template may recolour or animate; each one must occur in `text`. */
  emphasisWords: z.array(z.string().min(1).max(MAX_EMPHASIS_WORD_CHARACTERS)).max(MAX_EMPHASIS_WORDS_PER_CUE),
  /** Word timings when the audio pipeline produced them; null keeps the cue line-level. */
  words: z.array(subtitleCueWordSchema).min(1).max(40).nullable(),
});

export const productionDecorationSchema = z.object({
  kind: z.enum(DECORATION_KINDS),
  /** Manifest id from the bundled decoration catalogue; null for `floating_text`. */
  assetRef: z.enum(DECORATION_IDS).nullable(),
  /** Short overlay copy for `floating_text`; null for `sticker`. */
  text: z.string().min(1).max(12).nullable(),
  shotOrder: z.number().int().positive().max(12),
  startMs: shotTimestampMs,
  endMs: shotTimestampMs,
  anchor: z.enum(DECORATION_ANCHORS),
  scale: z.number().min(0.5).max(2),
  animation: z.enum(DECORATION_ANIMATIONS),
});

/**
 * What the planner may choose. Cue milliseconds are derived later from that shot's timeline —
 * asking a language model for startMs/endMs produced numbers that did not add up (#107).
 */
export const decorationSelectionSchema = z.object({
  shotOrder: z.number().int().positive().max(12),
  assetRef: z.enum(DECORATION_IDS),
  anchor: z.enum(DECORATION_ANCHORS),
  scale: z.number().min(0.5).max(2),
  animation: z.enum(DECORATION_ANIMATIONS),
});

export const productionSubtitleTimingSchema = z.object({
  precision: z.enum(SUBTITLE_TIMING_PRECISIONS),
  source: z.enum(SUBTITLE_TIMING_SOURCES),
});

export const productionSubtitleSettingsSchema = z.object({
  templateId: subtitleTemplateIdSchema,
  /** Evidence behind the cue boundaries, so the UI can explain the template it actually got. */
  timing: productionSubtitleTimingSchema,
  /** Template the user asked for when it was replaced for lack of word timing; null otherwise. */
  degradedFromTemplateId: subtitleTemplateIdSchema.nullable(),
});

const measuredShotTimestampMs = z.number().int().min(0).max(MAX_MEASURED_SHOT_MS);

/**
 * v4 实测镜头的字幕词级时间戳。v3 用单镜硬上限 20 秒封顶 cue 时间戳；v4 的镜头时长来自
 * 实测音频，超过 20 秒是软违规（用户确认后仍可渲染），时间戳上限因此放宽到
 * `MAX_MEASURED_SHOT_MS`，其余约束与 v3 保持一致。
 */
export const measuredSubtitleCueWordSchema = subtitleCueWordSchema.extend({
  startMs: measuredShotTimestampMs,
  endMs: measuredShotTimestampMs,
});

/** v4 实测镜头的字幕 cue：时间戳上限放宽到实测镜头上限，其余沿用 v3 cue 约束。 */
export const measuredSubtitleCueSchema = subtitleCueSchema.extend({
  startMs: measuredShotTimestampMs,
  endMs: measuredShotTimestampMs,
  words: z.array(measuredSubtitleCueWordSchema).min(1).max(40).nullable(),
});

/** v4 实测镜头上的装饰：时间戳上限同步放宽。 */
export const measuredProductionDecorationSchema = productionDecorationSchema.extend({
  startMs: measuredShotTimestampMs,
  endMs: measuredShotTimestampMs,
});

/**
 * v4 的字幕 timing 来源只能是实测：词级时间戳（`asr_word`）或实测句长（`tts_duration`），
 * 结构上排除估算来源——v4 的镜头时长本就来自实测音频，不存在纯估算的计划。
 */
export const measuredSubtitleTimingSchema = productionSubtitleTimingSchema.extend({
  source: z.enum(["asr_word", "tts_duration"]),
});

export const measuredProductionSubtitleSettingsSchema = productionSubtitleSettingsSchema.extend({
  timing: measuredSubtitleTimingSchema,
});

export type SubtitleCueWord = z.infer<typeof subtitleCueWordSchema>;
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;
export type MeasuredSubtitleCueWord = z.infer<typeof measuredSubtitleCueWordSchema>;
export type MeasuredSubtitleCue = z.infer<typeof measuredSubtitleCueSchema>;
export type ProductionDecoration = z.infer<typeof productionDecorationSchema>;
export type MeasuredProductionDecoration = z.infer<typeof measuredProductionDecorationSchema>;
export type DecorationSelection = z.infer<typeof decorationSelectionSchema>;
export type ProductionSubtitleTiming = z.infer<typeof productionSubtitleTimingSchema>;
export type ProductionSubtitleSettings = z.infer<typeof productionSubtitleSettingsSchema>;
export type MeasuredSubtitleTiming = z.infer<typeof measuredSubtitleTimingSchema>;
export type MeasuredProductionSubtitleSettings = z.infer<typeof measuredProductionSubtitleSettingsSchema>;
