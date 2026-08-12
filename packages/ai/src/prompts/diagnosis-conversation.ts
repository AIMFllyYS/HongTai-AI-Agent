import type { DiagnosisReportV1 } from "../schemas/diagnosis-report";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export function diagnosisConversationPrompt(report: DiagnosisReportV1): string {
  return `${DIAGNOSIS_COMMON_RULES}\n你正在基于一份已经校验的观察报告回答后续问题。回复自然中文文本，不输出JSON，不得超出报告证据或把状态参考升级为疾病诊断。\n首次报告：${JSON.stringify(report)}`;
}
