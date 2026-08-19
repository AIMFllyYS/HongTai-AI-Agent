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
import { productionDecorationSchema, productionSubtitleSettingsSchema, subtitleCueSchema } from "./production-plan-overlays";

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
});

export const productionPlanResultSchema = z.union([
  productionPlanResultV1Schema,
  productionPlanResultV2Schema,
  productionPlanResultV3Schema,
]);

export type ProductionPlanResultV1 = z.infer<typeof productionPlanResultV1Schema>;
export type ProductionPlanResultV2 = z.infer<typeof productionPlanResultV2Schema>;
export type ProductionPlanResultV3 = z.infer<typeof productionPlanResultV3Schema>;
export type ProductionPlanResult = z.infer<typeof productionPlanResultSchema>;

export const productionPlanResultJsonSchema = toProviderJsonSchema(productionPlanResultV2Schema);
export const productionPlanResultV3JsonSchema = toProviderJsonSchema(productionPlanResultV3Schema);
