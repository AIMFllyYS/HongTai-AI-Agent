import { diagnosisReportJsonSchema, type DiagnosisReportV1, type ObservationMode } from "../schemas/diagnosis-report";

const COMMON_RULES = `你是健康状态图片观察助手。只描述图片中可以看见的内容，并提供审慎的日常状态参考。
禁止给出疾病诊断、患病概率、处方或确定性医学结论。图片不可用时必须明确说明并给出重拍建议。
最终只输出一个JSON对象，不要Markdown代码块，不要thinking标签，不要在JSON外添加解释。`;

const REPORT_CONTRACT = `输出必须逐字段严格匹配以下JSON Schema，不得改名、增加包装层或省略必填字段：\n${JSON.stringify(diagnosisReportJsonSchema)}`;

export function diagnosisInitialPrompt(mode: ObservationMode): string {
  const subject = mode === "tongue" ? "舌象" : "面部状态";
  return `${COMMON_RULES}\n${REPORT_CONTRACT}\n本次只分析${subject}。Schema版本必须是diagnosis-report.v1，Prompt版本必须是diagnosis-initial.v1。观察项使用唯一ID，所有解释和建议只能引用存在的观察项ID。`;
}

export function diagnosisRepairPrompt(raw: string, mode: ObservationMode): string {
  return `${COMMON_RULES}\n${REPORT_CONTRACT}\n下面的响应无法通过${mode}报告Schema。只修复格式、字段和引用关系，不新增诊断结论。\n原始响应：\n${raw.slice(0, 24_000)}`;
}

export function diagnosisConversationPrompt(report: DiagnosisReportV1): string {
  return `${COMMON_RULES}\n你正在基于一份已经校验的观察报告回答后续问题。回复使用自然中文文本，不输出JSON。不得超出报告证据，不得把状态参考升级为疾病诊断。\n首次报告：\n${JSON.stringify(report)}`;
}
