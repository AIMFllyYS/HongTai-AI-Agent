import {
  MAX_CUE_CHARACTERS,
  MAX_EMPHASIS_WORD_CHARACTERS,
  MAX_EMPHASIS_WORDS_PER_CUE,
  SUBTITLE_TIMING_PRECISIONS,
  SUBTITLE_TIMING_SOURCES,
} from "@hongtai/core";
import { z } from "zod";

import { subtitleTemplateIdSchema } from "./subtitle-template";

/** Longest single shot allowed by the plan, used to bound every shot-relative timestamp. */
export const MAX_SHOT_MS = 20_000;

export const DECORATION_KINDS = ["sticker", "floating_text"] as const;

/**
 * Placement slots that never collide with the headline band or the caption band, so a
 * decoration cannot bury the copy the video depends on.
 */
export const DECORATION_ANCHORS = ["top_left", "top_right", "middle_left", "middle_right", "above_caption"] as const;

export const DECORATION_ANIMATIONS = ["none", "fade", "pop", "float"] as const;

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
  assetRef: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/u).nullable(),
  /** Short overlay copy for `floating_text`; null for `sticker`. */
  text: z.string().min(1).max(12).nullable(),
  shotOrder: z.number().int().positive().max(12),
  startMs: shotTimestampMs,
  endMs: shotTimestampMs,
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

export type SubtitleCueWord = z.infer<typeof subtitleCueWordSchema>;
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;
export type ProductionDecoration = z.infer<typeof productionDecorationSchema>;
export type ProductionSubtitleTiming = z.infer<typeof productionSubtitleTimingSchema>;
export type ProductionSubtitleSettings = z.infer<typeof productionSubtitleSettingsSchema>;
