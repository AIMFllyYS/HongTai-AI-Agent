import type { ContentAnalysisInput } from "../contracts/content-analysis";
import type { ContentAnalysisHookDrivers, ContentAnalysisOverview, ContentAnalysisStructureClaims } from "../schemas/content-analysis";
import { contentAnalysisStyleTemplateJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_STYLE_TEMPLATE_PROMPT_VERSION = "content-analysis.style-template.v1";

const contract = `严格匹配此Schema：${JSON.stringify(contentAnalysisStyleTemplateJsonSchema)}`;

export function contentAnalysisStyleTemplatePrompt(
  input: ContentAnalysisInput,
  prior: ContentAnalysisOverview & ContentAnalysisHookDrivers & ContentAnalysisStructureClaims,
): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n只生成style和reusableTemplate。已校验前置模块：${JSON.stringify(prior)}\n证据单元：${contentEvidence(input)}`;
}

export function contentAnalysisStyleTemplateRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n校正本模块格式，不新增内容证据。证据单元：${contentEvidence(input)}\n原始响应：${raw.slice(0, 16_000)}`;
}
