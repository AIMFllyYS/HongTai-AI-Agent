import type { ObservationMode } from "../schemas/diagnosis-report";
import { diagnosisVisualObservationsJsonSchema } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_VISUAL_OBSERVATIONS_PROMPT_VERSION = "diagnosis.visual-observations.v1";

const contract = `严格匹配此Schema：${JSON.stringify(diagnosisVisualObservationsJsonSchema)}`;

export function diagnosisVisualObservationsPrompt(mode: ObservationMode): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n只观察${mode === "tongue" ? "舌象" : "面部状态"}，只生成imageQuality和observations。观察ID必须唯一，分类必须与模式匹配。`;
}

export function diagnosisVisualObservationsRepairPrompt(raw: string, mode: ObservationMode): string {
  return `${DIAGNOSIS_COMMON_RULES}\n${contract}\n校正${mode}可见观察模块的格式、ID和分类，不新增诊断结论。原始响应：${raw.slice(0, 16_000)}`;
}
