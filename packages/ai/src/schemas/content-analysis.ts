import { z } from "zod";
import { toProviderJsonSchema } from "../structured-output/json-schema";

const evidenceRefs = z.array(z.string().min(1));

export const contentAnalysisResultSchema = z.object({
  schemaVersion: z.literal("content-analysis.v1"),
  source: z.object({
    taskId: z.string().min(1),
    platform: z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "local_upload"]),
    contentType: z.enum(["video", "image_text"]),
    sourceKind: z.enum(["asr", "description", "image_text"]),
  }),
  overview: z.object({
    summary: z.string().min(1),
    theme: z.string().min(1),
    targetAudiences: z.array(z.string()),
    communicationGoal: z.string().min(1),
  }),
  hook: z.object({
    type: z.enum(["pain_point", "question", "contrast", "result", "story", "other"]),
    description: z.string().min(1),
    mechanism: z.string().min(1),
    evidenceRefs,
  }),
  painPoints: z.array(z.object({ description: z.string().min(1), evidenceRefs })),
  emotionalDrivers: z.array(z.object({ description: z.string().min(1), evidenceRefs })),
  structure: z.array(z.object({
    order: z.number().int().positive(),
    role: z.enum(["opening", "development", "proof", "transition", "closing", "other"]),
    summary: z.string().min(1),
    techniques: z.array(z.string()),
    evidenceRefs,
  })),
  coreClaims: z.array(z.object({
    claim: z.string().min(1),
    supportLevel: z.enum(["explicit", "inferred"]),
    evidenceRefs,
  })),
  style: z.object({
    tones: z.array(z.string()),
    pacing: z.string().min(1),
    languagePatterns: z.array(z.string()),
    interactionMechanisms: z.array(z.string()),
  }),
  reusableTemplate: z.object({
    formula: z.string().min(1),
    steps: z.array(z.string()),
    variableSlots: z.array(z.string()),
    doNotCopy: z.array(z.string()),
  }),
  risks: z.array(z.object({
    category: z.enum(["medical_claim", "exaggeration", "unsupported_claim", "copyright_imitation", "other"]),
    level: z.enum(["low", "medium", "high"]),
    description: z.string().min(1),
    evidenceRefs,
    suggestion: z.string().min(1),
  })),
});

export type ContentAnalysisResultV1 = z.infer<typeof contentAnalysisResultSchema>;
export const contentAnalysisResultJsonSchema = toProviderJsonSchema(contentAnalysisResultSchema);
