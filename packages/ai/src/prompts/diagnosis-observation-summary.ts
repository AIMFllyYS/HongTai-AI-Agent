import type { DiagnosisVisualObservations, ObservationMode } from "../schemas/diagnosis-report";
import { diagnosisObservationSummaryJsonSchema } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_OBSERVATION_SUMMARY_PROMPT_VERSION = "diagnosis.observation-summary.v1";

const contract = `严格匹配此Schema：${JSON.stringify(diagnosisObservationSummaryJsonSchema)}`;

export function diagnosisObservationSummaryPrompt(mode: ObservationMode, visual: DiagnosisVisualObservations): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n只生成${mode === "tongue" ? "舌象" : "面部"}观察摘要summary。已校验观察：${JSON.stringify(visual)}`;
}

export function diagnosisObservationSummaryRepairPrompt(raw: string): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n校正观察摘要模块结构，不增加新观察。原始响应：${raw.slice(0, 16_000)}`;
}
