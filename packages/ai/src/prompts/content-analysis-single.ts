import type { ContentAnalysisInput } from "../contracts/content-analysis";
import { contentAnalysisSingleResponseJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_SINGLE_PROMPT_VERSION = "content-analysis-single-stream.v1";

const compactContract = `输出必须严格匹配这个单对象Schema：${JSON.stringify(contentAnalysisSingleResponseJsonSchema)}`;

export function contentAnalysisSinglePrompt(input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}
一次完成全部拆解，并按overview、hookDrivers、structureClaims、styleTemplate、risksBoundaries顺序输出一个JSON对象。
${compactContract}
以下真实证据单元只提供这一次；不得使用标题、作者或外部知识补充证据：${contentEvidence(input)}`;
}

export function contentAnalysisSingleRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}
${compactContract}
校正下面整份响应的JSON结构和证据引用，只能引用这些证据ID：${JSON.stringify(input.evidenceUnits.map((item) => item.id))}
原始响应：${raw.slice(0, 20_000)}`;
}
