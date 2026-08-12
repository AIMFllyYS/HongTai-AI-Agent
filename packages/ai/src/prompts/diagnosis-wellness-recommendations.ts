import type { DiagnosisObservationSummary, DiagnosisVisualObservations } from "../schemas/diagnosis-report";
import { diagnosisWellnessRecommendationsJsonSchema } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_WELLNESS_RECOMMENDATIONS_PROMPT_VERSION = "diagnosis.wellness-recommendations.v1";

const contract = `严格匹配此Schema：${JSON.stringify(diagnosisWellnessRecommendationsJsonSchema)}`;

export function diagnosisWellnessRecommendationsPrompt(
  visual: DiagnosisVisualObservations,
  summary: DiagnosisObservationSummary,
): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n只生成wellnessReferences和recommendations，引用只能指向已校验观察ID。已校验上下文：${JSON.stringify({ ...visual, ...summary })}`;
}

export function diagnosisWellnessRecommendationsRepairPrompt(raw: string, observationIds: readonly string[]): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n校正状态参考和建议模块，合法观察ID：${observationIds.join(",")}。原始响应：${raw.slice(0, 16_000)}`;
}
