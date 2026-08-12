import { z } from "zod";
import { toProviderJsonSchema } from "../structured-output/json-schema";

export const contentEvidenceRefsSchema = z.array(z.string().min(1));

export const contentAnalysisOverviewSchema = z.object({
  overview: z.object({
    summary: z.string().min(1),
    theme: z.string().min(1),
    targetAudiences: z.array(z.string()),
    communicationGoal: z.string().min(1),
  }),
});

export const contentAnalysisHookDriversSchema = z.object({
  hook: z.object({
    type: z.enum(["pain_point", "question", "contrast", "result", "story", "other"]),
    description: z.string().min(1),
    mechanism: z.string().min(1),
    evidenceRefs: contentEvidenceRefsSchema,
  }),
  painPoints: z.array(z.object({ description: z.string().min(1), evidenceRefs: contentEvidenceRefsSchema })),
  emotionalDrivers: z.array(z.object({ description: z.string().min(1), evidenceRefs: contentEvidenceRefsSchema })),
});

export const contentAnalysisStructureClaimsSchema = z.object({
  structure: z.array(z.object({
    order: z.number().int().positive(),
    role: z.enum(["opening", "development", "proof", "transition", "closing", "other"]),
    summary: z.string().min(1),
    techniques: z.array(z.string()),
    evidenceRefs: contentEvidenceRefsSchema,
  })),
  coreClaims: z.array(z.object({
    claim: z.string().min(1),
    supportLevel: z.enum(["explicit", "inferred"]),
    evidenceRefs: contentEvidenceRefsSchema,
  })),
});

export const contentAnalysisStyleTemplateSchema = z.object({
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
});

export const contentAnalysisRisksBoundariesSchema = z.object({
  risks: z.array(z.object({
    category: z.enum(["medical_claim", "exaggeration", "unsupported_claim", "copyright_imitation", "other"]),
    level: z.enum(["low", "medium", "high"]),
    description: z.string().min(1),
    evidenceRefs: contentEvidenceRefsSchema,
    suggestion: z.string().min(1),
  })),
});

export const contentAnalysisSourceSchema = z.object({
  taskId: z.string().min(1),
  platform: z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "local_upload"]),
  contentType: z.enum(["video", "image_text"]),
  sourceKind: z.enum(["asr", "description", "image_text"]),
});

export const contentAnalysisResultSchema = z.object({
  schemaVersion: z.literal("content-analysis.v1"),
  source: contentAnalysisSourceSchema,
  ...contentAnalysisOverviewSchema.shape,
  ...contentAnalysisHookDriversSchema.shape,
  ...contentAnalysisStructureClaimsSchema.shape,
  ...contentAnalysisStyleTemplateSchema.shape,
  ...contentAnalysisRisksBoundariesSchema.shape,
});

export type ContentAnalysisOverview = z.infer<typeof contentAnalysisOverviewSchema>;
export type ContentAnalysisHookDrivers = z.infer<typeof contentAnalysisHookDriversSchema>;
export type ContentAnalysisStructureClaims = z.infer<typeof contentAnalysisStructureClaimsSchema>;
export type ContentAnalysisStyleTemplate = z.infer<typeof contentAnalysisStyleTemplateSchema>;
export type ContentAnalysisRisksBoundaries = z.infer<typeof contentAnalysisRisksBoundariesSchema>;
export type ContentAnalysisResultV1 = z.infer<typeof contentAnalysisResultSchema>;

export const contentAnalysisOverviewJsonSchema = toProviderJsonSchema(contentAnalysisOverviewSchema);
export const contentAnalysisHookDriversJsonSchema = toProviderJsonSchema(contentAnalysisHookDriversSchema);
export const contentAnalysisStructureClaimsJsonSchema = toProviderJsonSchema(contentAnalysisStructureClaimsSchema);
export const contentAnalysisStyleTemplateJsonSchema = toProviderJsonSchema(contentAnalysisStyleTemplateSchema);
export const contentAnalysisRisksBoundariesJsonSchema = toProviderJsonSchema(contentAnalysisRisksBoundariesSchema);
export const contentAnalysisResultJsonSchema = toProviderJsonSchema(contentAnalysisResultSchema);
