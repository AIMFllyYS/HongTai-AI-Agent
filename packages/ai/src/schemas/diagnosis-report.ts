import { z } from "zod";

export const observationModeSchema = z.enum(["tongue", "face"]);
export type ObservationMode = z.infer<typeof observationModeSchema>;

const observationCategorySchema = z.enum([
  "tongue_body", "tongue_coating", "tongue_moisture", "tongue_shape",
  "facial_color", "facial_skin", "localized_feature",
]);

export const diagnosisReportSchema = z.object({
  schemaVersion: z.literal("diagnosis-report.v1"),
  mode: observationModeSchema,
  promptVersion: z.literal("diagnosis-initial.v1"),
  imageQuality: z.object({
    usable: z.boolean(),
    overallQuality: z.enum(["good", "limited", "unusable"]),
    limitations: z.array(z.string()),
    retakeSuggestions: z.array(z.string()),
  }),
  summary: z.object({
    headline: z.string().min(1),
    keyPoints: z.array(z.string()).min(1).max(5),
    narrative: z.string().min(1),
  }),
  observations: z.array(z.object({
    id: z.string().min(1),
    category: observationCategorySchema,
    region: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    visibility: z.enum(["clear", "limited", "not_assessable"]),
    evidenceDescription: z.string().min(1),
  })),
  wellnessReferences: z.array(z.object({
    title: z.string().min(1),
    basisObservationIds: z.array(z.string()),
    statement: z.string().min(1),
    certainty: z.enum(["possible", "uncertain"]),
    notADiagnosis: z.literal(true),
  })),
  recommendations: z.array(z.object({
    category: z.enum(["daily_care", "diet_lifestyle", "monitoring"]),
    priority: z.enum(["low", "medium", "high"]),
    title: z.string().min(1),
    action: z.string().min(1),
    rationale: z.string().min(1),
    relatedObservationIds: z.array(z.string()),
  })),
  safetyGuidance: z.object({
    level: z.enum(["none", "routine_attention", "prompt_consultation", "urgent"]),
    reasons: z.array(z.string()),
    recommendedAction: z.string().min(1),
  }),
  followUpQuestions: z.array(z.string()),
  limitations: z.array(z.string()).min(1),
  disclaimer: z.string().min(1),
}).superRefine((report, context) => {
  if ((!report.imageQuality.usable || report.imageQuality.overallQuality === "unusable") && report.observations.length > 0) {
    context.addIssue({ code: "custom", path: ["observations"], message: "图片不可用时不能输出可见观察项" });
  }
  if (report.imageQuality.usable && report.imageQuality.overallQuality === "unusable") {
    context.addIssue({ code: "custom", path: ["imageQuality"], message: "图片可用性与总体质量矛盾" });
  }
  const ids = new Set(report.observations.map((item) => item.id));
  if (ids.size !== report.observations.length) {
    context.addIssue({ code: "custom", path: ["observations"], message: "观察项ID必须唯一" });
  }
  const references = [
    ...report.wellnessReferences.flatMap((item) => item.basisObservationIds),
    ...report.recommendations.flatMap((item) => item.relatedObservationIds),
  ];
  if (references.some((id) => !ids.has(id))) {
    context.addIssue({ code: "custom", path: ["observations"], message: "解释或建议引用了不存在的观察项" });
  }
  const allowedPrefix = report.mode === "tongue" ? "tongue_" : "facial_";
  if (report.observations.some((item) => item.category !== "localized_feature" && !item.category.startsWith(allowedPrefix))) {
    context.addIssue({ code: "custom", path: ["observations"], message: "观察分类与图片类型不匹配" });
  }
});

export type DiagnosisReportV1 = z.infer<typeof diagnosisReportSchema>;
