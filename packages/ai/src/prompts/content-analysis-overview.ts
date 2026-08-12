import type { ContentAnalysisInput } from "../contracts/content-analysis";
import { contentAnalysisOverviewJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_OVERVIEW_PROMPT_VERSION = "content-analysis.overview.v1";

const contract = `严格匹配此Schema：${JSON.stringify(contentAnalysisOverviewJsonSchema)}`;

export function contentAnalysisOverviewPrompt(input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n只生成overview。证据单元：${contentEvidence(input)}`;
}

export function contentAnalysisOverviewRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n校正overview模块的格式，不新增事实。证据单元：${contentEvidence(input)}\n原始响应：${raw.slice(0, 16_000)}`;
}
