import type {
  DiagnosisObservationSummary,
  DiagnosisVisualObservations,
  DiagnosisWellnessRecommendations,
} from "../schemas/diagnosis-report";
import { diagnosisSafetyLimitationsJsonSchema } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_SAFETY_LIMITATIONS_PROMPT_VERSION = "diagnosis.safety-limitations.v1";

const contract = `严格匹配此Schema：${JSON.stringify(diagnosisSafetyLimitationsJsonSchema)}`;

export function diagnosisSafetyLimitationsPrompt(
  prior: DiagnosisVisualObservations & DiagnosisObservationSummary & DiagnosisWellnessRecommendations,
): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n只生成safetyGuidance、limitations和disclaimer。已校验上下文：${JSON.stringify(prior)}`;
}

export function diagnosisSafetyLimitationsRepairPrompt(raw: string): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n校正安全与限制模块结构，不增加诊断。原始响应：${raw.slice(0, 16_000)}`;
}
