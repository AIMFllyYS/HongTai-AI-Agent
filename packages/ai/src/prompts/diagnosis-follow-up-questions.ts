import type {
  DiagnosisObservationSummary,
  DiagnosisSafetyLimitations,
  DiagnosisVisualObservations,
  DiagnosisWellnessRecommendations,
} from "../schemas/diagnosis-report";
import { diagnosisFollowUpQuestionsJsonSchema } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_FOLLOW_UP_QUESTIONS_PROMPT_VERSION = "diagnosis.follow-up-questions.v1";

const contract = `严格匹配此Schema：${JSON.stringify(diagnosisFollowUpQuestionsJsonSchema)}`;

export function diagnosisFollowUpQuestionsPrompt(
  prior: DiagnosisVisualObservations & DiagnosisObservationSummary & DiagnosisWellnessRecommendations & DiagnosisSafetyLimitations,
): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n只生成必要的followUpQuestions。已校验上下文：${JSON.stringify(prior)}`;
}

export function diagnosisFollowUpQuestionsRepairPrompt(raw: string): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n校正追问模块结构，不新增医学结论。原始响应：${raw.slice(0, 16_000)}`;
}
