import { TaskError } from "@hongtai/core";
import type { StructuredGenerationModuleId } from "@hongtai/core";

import { DIAGNOSIS_SINGLE_PROMPT_VERSION } from "../../prompts/diagnosis-report-single";
import {
  diagnosisFollowUpQuestionsSchema,
  diagnosisObservationSummarySchema,
  diagnosisReportSchema,
  diagnosisSafetyLimitationsSchema,
  diagnosisSingleResponseFieldSchemas,
  diagnosisVisualObservationsSchema,
  diagnosisWellnessRecommendationsSchema,
  type DiagnosisFollowUpQuestions,
  type DiagnosisObservationSummary,
  type DiagnosisReportV1,
  type DiagnosisSafetyLimitations,
  type DiagnosisSingleResponse,
  type DiagnosisVisualObservations,
  type DiagnosisWellnessRecommendations,
  type ObservationMode,
} from "../../schemas/diagnosis-report";
import type { CompletedTopLevelJsonField } from "../../structured-output/top-level-json-field-stream";

export const REPORT_MODULE_IDS = [
  "visual-observations",
  "observation-summary",
  "wellness-recommendations",
  "safety-limitations",
  "follow-up-questions",
] as const satisfies readonly StructuredGenerationModuleId[];

export const REPORT_PROMPT_VERSIONS = [DIAGNOSIS_SINGLE_PROMPT_VERSION] as const;
export const SINGLE_RESPONSE_KEYS = ["quality", "qualityNote", "observations", "summary", "wellnessReferences", "advice", "safety", "followUp"] as const;
const FIXED_DISCLAIMER = "本报告给出基于图片的初步判断，仅供日常参考和到医院正规核实，不是正式诊疗结论，不提供患病概率或健康评分，也不能替代专业检查。";
const HEADLINE_SUMMARY_MAX_CHARS = 24;

function usableHeadline(observations: readonly { readonly label: string }[], summary: string, fallback: string): string {
  const label = observations[0]?.label.trim();
  if (label) return label;
  return (summary.trim() || fallback).slice(0, HEADLINE_SUMMARY_MAX_CHARS);
}

function compactFollowUpQuestions(followUp: string): string[] {
  if (!followUp.trim()) return [];
  return followUp.split("；").map((item) => item.trim()).filter(Boolean).slice(0, 2);
}

interface DiagnosisSections {
  readonly visual: DiagnosisVisualObservations;
  readonly summary: DiagnosisObservationSummary;
  readonly wellness: DiagnosisWellnessRecommendations;
  readonly safety: DiagnosisSafetyLimitations;
  readonly followUp: DiagnosisFollowUpQuestions;
}

export function structuredIssue(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", ...(cause === undefined ? {} : { cause }) });
}

export function diagnosisSections(value: DiagnosisSingleResponse): DiagnosisSections {
  const usable = value.quality !== "unusable";
  const qualityNote = value.qualityNote.trim();
  const advice = value.advice.trim();
  const observations = usable ? value.observations : [];
  const observationIds = observations.map((_, index) => `obs-${index + 1}`);
  const visual: DiagnosisVisualObservations = {
    imageQuality: {
      usable,
      overallQuality: value.quality,
      limitations: value.quality === "good" ? [] : [qualityNote],
      retakeSuggestions: value.quality === "good" ? [] : ["请在自然光、对焦清晰且无遮挡的条件下重新拍摄。"],
    },
    observations: observations.map((item, index) => ({
      id: observationIds[index]!,
      category: item.category,
      region: item.region,
      label: item.label,
      description: item.description,
      visibility: value.quality === "good" ? "clear" : "limited",
      evidenceDescription: item.description,
    })),
  };
  const fallbackSummary = usable ? "本次图片未形成更多可确认的可见信息。" : "当前图片质量不足，暂不形成可见状态结论。";
  const summary: DiagnosisObservationSummary = {
    summary: {
      headline: usable ? usableHeadline(observations, value.summary, fallbackSummary) : "图片暂不适合观察",
      keyPoints: observations.length > 0
        ? observations.slice(0, 5).map((item) => item.description)
        : [value.summary || fallbackSummary],
      narrative: value.summary || fallbackSummary,
    },
  };
  const wellness: DiagnosisWellnessRecommendations = {
    wellnessReferences: observations.length > 0 ? value.wellnessReferences.map((item) => ({
      title: item.title,
      basisObservationIds: observationIds,
      statement: `${item.statement.replace(/[。；;\s]+$/u, "")}；单张图片不能据此诊断。`,
      certainty: "uncertain",
      notADiagnosis: true,
    })) : [],
    recommendations: observations.length > 0 && advice ? [{
      category: "monitoring",
      priority: "low",
      title: "日常记录建议",
      action: advice,
      rationale: "基于本次图片中已确认的可见状态，建议只用于日常记录和变化比较。",
      relatedObservationIds: observationIds,
    }] : [],
  };
  const safety: DiagnosisSafetyLimitations = {
    safetyGuidance: {
      level: usable ? "none" : "routine_attention",
      reasons: usable ? [] : [qualityNote || "当前图片不足以支持可见状态观察。"],
      recommendedAction: value.safety,
    },
    limitations: [
      "单张图片与拍摄条件会限制可见信息，不能替代专业检查。",
      ...(value.quality === "good" ? [] : ["建议在更合适的拍摄条件下重新记录。"]),
    ],
    disclaimer: FIXED_DISCLAIMER,
  };
  const followUp: DiagnosisFollowUpQuestions = {
    followUpQuestions: compactFollowUpQuestions(value.followUp),
  };
  return { visual, summary, wellness, safety, followUp };
}

export function validatedReport(value: DiagnosisSingleResponse, mode: ObservationMode): DiagnosisReportV1 {
  const sections = diagnosisSections(value);
  const result = diagnosisReportSchema.safeParse({
    schemaVersion: "diagnosis-report.v1",
    mode,
    promptVersion: DIAGNOSIS_SINGLE_PROMPT_VERSION,
    ...sections.visual,
    ...sections.summary,
    ...sections.wellness,
    ...sections.safety,
    ...sections.followUp,
  });
  if (!result.success) throw structuredIssue("观察报告组装后不符合最终Schema", result.error);
  return result.data;
}

export function acceptDiagnosisField(
  fields: Partial<DiagnosisSingleResponse>,
  field: CompletedTopLevelJsonField,
): void {
  const schema = diagnosisSingleResponseFieldSchemas[field.key as keyof typeof diagnosisSingleResponseFieldSchemas];
  if (!schema) return;
  const parsed = schema.safeParse(field.value);
  if (!parsed.success) throw structuredIssue(`诊察字段${field.key}不符合Schema`, parsed.error);
  switch (field.key) {
    case "quality": fields.quality = parsed.data as DiagnosisSingleResponse["quality"]; break;
    case "qualityNote": fields.qualityNote = parsed.data as string; break;
    case "observations": fields.observations = parsed.data as DiagnosisSingleResponse["observations"]; break;
    case "summary": fields.summary = parsed.data as string; break;
    case "wellnessReferences": fields.wellnessReferences = parsed.data as DiagnosisSingleResponse["wellnessReferences"]; break;
    case "advice": fields.advice = parsed.data as string; break;
    case "safety": fields.safety = parsed.data as string; break;
    case "followUp": fields.followUp = parsed.data as string; break;
  }
}

export function diagnosisModuleResult(
  fields: Partial<DiagnosisSingleResponse>,
  _mode: ObservationMode,
  index: number,
): object | undefined {
  const has = (key: keyof DiagnosisSingleResponse): boolean => fields[key] !== undefined;
  const ready = [
    has("quality") && has("qualityNote") && has("observations"),
    has("summary"),
    has("quality") && has("observations") && has("wellnessReferences") && has("advice"),
    has("quality") && has("safety"),
    has("followUp"),
  ][index];
  if (!ready) return undefined;
  if (fields.quality === "unusable" && fields.observations?.length) throw structuredIssue("图片不可用时不能展示可见观察");
  if (fields.quality === "unusable" && fields.advice) throw structuredIssue("图片不可用时不能展示无依据建议");
  if (fields.quality === "unusable" && fields.wellnessReferences?.length) throw structuredIssue("图片不可用时不能展示传统状态参考");
  const sections = diagnosisSections({
    quality: fields.quality ?? "unusable",
    qualityNote: fields.qualityNote ?? "当前图片不足以支持可见状态观察。",
    observations: fields.observations ?? [],
    summary: fields.summary ?? "",
    wellnessReferences: fields.wellnessReferences ?? [],
    advice: fields.advice ?? "",
    safety: fields.safety ?? "安全说明正在生成。",
    followUp: fields.followUp ?? "",
  });
  const candidate = [sections.visual, sections.summary, sections.wellness, sections.safety, sections.followUp][index];
  const schema = [
    diagnosisVisualObservationsSchema,
    diagnosisObservationSummarySchema,
    diagnosisWellnessRecommendationsSchema,
    diagnosisSafetyLimitationsSchema,
    diagnosisFollowUpQuestionsSchema,
  ][index];
  const parsed = schema?.safeParse(candidate);
  if (!parsed?.success) throw structuredIssue("诊察板块不符合安全展示Schema", parsed?.error);
  return parsed.data as object;
}
