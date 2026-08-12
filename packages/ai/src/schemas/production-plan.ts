import { z } from "zod";

import { toProviderJsonSchema } from "../structured-output/json-schema";

export const productionPlanResultSchema = z.object({
  schemaVersion: z.literal("production-plan.v1"),
  source: z.object({ analysisTaskId: z.string().min(1) }),
  title: z.string().min(1).max(80),
  settings: z.object({
    width: z.literal(720),
    height: z.literal(1280),
    fps: z.literal(30),
    durationSeconds: z.number().min(15).max(60),
  }),
  audio: z.object({
    voiceLocale: z.literal("zh-CN"),
    speechRate: z.number().min(0.75).max(1.25),
    backgroundMusicAssetId: z.string().min(1).nullable(),
    backgroundMusicVolume: z.number().min(0).max(0.35),
  }),
  shots: z.array(z.object({
    order: z.number().int().positive(),
    assetId: z.string().min(1),
    durationSeconds: z.number().min(1).max(20),
    narration: z.string().min(1).max(160),
    caption: z.string().min(1).max(40),
    fit: z.enum(["cover", "contain"]),
  })).min(1).max(12),
});

export type ProductionPlanResultV1 = z.infer<typeof productionPlanResultSchema>;
export const productionPlanResultJsonSchema = toProviderJsonSchema(productionPlanResultSchema);
