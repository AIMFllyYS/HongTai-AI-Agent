import { z } from "zod";
import { toProviderJsonSchema } from "../structured-output/json-schema";
import { rejectDiagnosisStructuralOverreach } from "./diagnosis-medical-boundary";

export const observationModeSchema = z.enum(["tongue", "face"]);
export type ObservationMode = z.infer<typeof observationModeSchema>;

export const observationCategorySchema = z.enum([
  "tongue_body", "tongue_coating", "tongue_moisture", "tongue_shape",
  "facial_color", "facial_skin", "localized_feature",
]);

export const diagnosisVisualObservationsSchema = z.object({
  imageQuality: z.object({
    usable: z.boolean(),
    overallQuality: z.enum(["good", "limited", "unusable"]),
    limitations: z.array(z.string()),
    retakeSuggestions: z.array(z.string()),
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
}).superRefine((value, context) => {
  if ((!value.imageQuality.usable || value.imageQuality.overallQuality === "unusable") && value.observations.length > 0) {
    context.addIssue({ code: "custom", path: ["observations"], message: "图片不可用时不能输出可见观察项" });
  }
  if (value.imageQuality.usable && value.imageQuality.overallQuality === "unusable") {
    context.addIssue({ code: "custom", path: ["imageQuality"], message: "图片可用性与总体质量矛盾" });
  }
  const ids = new Set(value.observations.map((item) => item.id));
  if (ids.size !== value.observations.length) {
    context.addIssue({ code: "custom", path: ["observations"], message: "观察项ID必须唯一" });
  }
});

export const diagnosisObservationSummarySchema = z.object({
  summary: z.object({
    headline: z.string().min(1),
    keyPoints: z.array(z.string()).min(1).max(5),
    narrative: z.string().min(1),
  }),
});

/**
 * 图片观察医疗边界分三层，职责不可互相替代：
 * 1. 无越界字段：本 Schema 不存在健康评分、处方或患病概率字段。
 * 2. 组装强制：DiagnosisFlow 写入 certainty=uncertain、notADiagnosis=true 与固定免责声明。
 * 3. 本层拦截越界声明：对 statement 与 action 做结构型检查（确诊/诊断为、概率+数字或%、
 *    处方/用药剂量、健康评分）。流式板块只走本字段级 Schema，故必须在此拦截，
 *    否则进度板块会先放出越界句。不依赖缓和词，也不维护疾病名词典。
 */
export const diagnosisWellnessRecommendationsSchema = z.object({
  wellnessReferences: z.array(z.object({
    title: z.string().min(1),
    basisObservationIds: z.array(z.string()),
    statement: z.string().min(1).superRefine(rejectDiagnosisStructuralOverreach),
    certainty: z.enum(["possible", "uncertain"]),
    notADiagnosis: z.literal(true),
  })),
  recommendations: z.array(z.object({
    category: z.enum(["daily_care", "diet_lifestyle", "monitoring"]),
    priority: z.enum(["low", "medium", "high"]),
    title: z.string().min(1),
    action: z.string().min(1).superRefine(rejectDiagnosisStructuralOverreach),
    rationale: z.string().min(1),
    relatedObservationIds: z.array(z.string()),
  })),
});

export const diagnosisSafetyLimitationsSchema = z.object({
  safetyGuidance: z.object({
    level: z.enum(["none", "routine_attention", "prompt_consultation", "urgent"]),
    reasons: z.array(z.string()),
    recommendedAction: z.string().min(1),
  }),
  limitations: z.array(z.string()).min(1),
  disclaimer: z.string().min(1),
});

export const diagnosisFollowUpQuestionsSchema = z.object({
  followUpQuestions: z.array(z.string()),
});

export const diagnosisSingleResponseFieldSchemas = {
  quality: z.enum(["good", "limited", "unusable"]),
  qualityNote: z.string().trim().max(1000),
  observations: z.array(z.object({
    category: observationCategorySchema,
    region: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1000),
  }).strict()).max(6),
  summary: z.string().trim().max(2000),
  wellnessReferences: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    statement: z.string().trim().min(1).max(2000).superRefine(rejectDiagnosisStructuralOverreach),
  }).strict()).max(3),
  advice: z.string().trim().max(2000).superRefine(rejectDiagnosisStructuralOverreach),
  safety: z.string().trim().min(1).max(2000),
  followUp: z.string().trim().max(500),
} as const;

/** 紧凑响应同步挂第3层：statement 与 advice 在字段级拦截越界声明，供流式接收与整单校验共用。 */
export const diagnosisSingleResponseSchema = z.object(diagnosisSingleResponseFieldSchemas).strict().superRefine((value, context) => {
  if (value.quality === "good" && value.observations.length < 3) {
    context.addIssue({ code: "custom", path: ["observations"], message: "清晰图片应输出3至6条独立观察" });
  }
  if (value.quality === "limited" && value.observations.length < 1) {
    context.addIssue({ code: "custom", path: ["observations"], message: "有限可用图片应保留至少一条可见观察" });
  }
  if (value.quality !== "good" && !value.qualityNote) {
    context.addIssue({ code: "custom", path: ["qualityNote"], message: "有限或不可用图片必须说明具体质量限制" });
  }
  if (value.quality === "unusable" && value.observations.length > 0) {
    context.addIssue({ code: "custom", path: ["observations"], message: "图片不可用时不能输出可见观察" });
  }
  if (value.quality === "unusable" && value.advice) {
    context.addIssue({ code: "custom", path: ["advice"], message: "图片不可用时不能输出无依据建议" });
  }
  if (value.quality === "unusable" && value.wellnessReferences.length > 0) {
    context.addIssue({ code: "custom", path: ["wellnessReferences"], message: "图片不可用时不能输出传统状态参考" });
  }
  value.wellnessReferences.forEach((item, index) => {
    if (!/(可能|有时|不确定)/u.test(item.statement)) {
      context.addIssue({ code: "custom", path: ["wellnessReferences", index, "statement"], message: "传统状态参考必须明确表达不确定性" });
    }
  });
  if (value.quality === "unusable" && value.summary && !/(不可用|无法|重拍|不足)/u.test(value.summary)) {
    context.addIssue({ code: "custom", path: ["summary"], message: "图片不可用时摘要只能说明限制与重拍" });
  }
});

const diagnosisReportBaseSchema = z.object({
  schemaVersion: z.literal("diagnosis-report.v1"),
  mode: observationModeSchema,
  promptVersion: z.union([
    z.literal("diagnosis-initial.v1"),
    z.literal("diagnosis-modular.v1"),
    z.literal("diagnosis-single-stream.v1"),
    z.literal("diagnosis-single-stream.v2"),
    z.literal("diagnosis-single-stream.v3"),
  ]),
  imageQuality: diagnosisVisualObservationsSchema.shape.imageQuality,
  observations: diagnosisVisualObservationsSchema.shape.observations,
  ...diagnosisObservationSummarySchema.shape,
  ...diagnosisWellnessRecommendationsSchema.shape,
  ...diagnosisSafetyLimitationsSchema.shape,
  ...diagnosisFollowUpQuestionsSchema.shape,
});

export const diagnosisReportSchema = diagnosisReportBaseSchema.superRefine((report, context) => {
  const visual = diagnosisVisualObservationsSchema.safeParse({ imageQuality: report.imageQuality, observations: report.observations });
  if (!visual.success) {
    for (const issue of visual.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  const wellness = diagnosisWellnessRecommendationsSchema.safeParse({
    wellnessReferences: report.wellnessReferences,
    recommendations: report.recommendations,
  });
  if (!wellness.success) {
    for (const issue of wellness.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
  const ids = new Set(report.observations.map((item) => item.id));
  const references = [
    ...report.wellnessReferences.flatMap((item) => item.basisObservationIds),
    ...report.recommendations.flatMap((item) => item.relatedObservationIds),
  ];
  if (references.some((id) => !ids.has(id))) {
    context.addIssue({ code: "custom", path: ["observations"], message: "解释或建议引用了不存在的观察项" });
  }
  if (!report.imageQuality.usable && (report.wellnessReferences.length > 0 || report.recommendations.length > 0)) {
    context.addIssue({ code: "custom", path: ["recommendations"], message: "图片不可用时不能生成无依据的状态参考或建议" });
  }
  const allowedPrefix = report.mode === "tongue" ? "tongue_" : "facial_";
  if (report.observations.some((item) => item.category !== "localized_feature" && !item.category.startsWith(allowedPrefix))) {
    context.addIssue({ code: "custom", path: ["observations"], message: "观察分类与图片类型不匹配" });
  }
});

export type DiagnosisVisualObservations = z.infer<typeof diagnosisVisualObservationsSchema>;
export type DiagnosisObservationSummary = z.infer<typeof diagnosisObservationSummarySchema>;
export type DiagnosisWellnessRecommendations = z.infer<typeof diagnosisWellnessRecommendationsSchema>;
export type DiagnosisSafetyLimitations = z.infer<typeof diagnosisSafetyLimitationsSchema>;
export type DiagnosisFollowUpQuestions = z.infer<typeof diagnosisFollowUpQuestionsSchema>;
export type DiagnosisSingleResponse = z.infer<typeof diagnosisSingleResponseSchema>;
export type DiagnosisReportV1 = z.infer<typeof diagnosisReportSchema>;

export const diagnosisSingleResponseJsonSchema = toProviderJsonSchema(diagnosisSingleResponseSchema);
