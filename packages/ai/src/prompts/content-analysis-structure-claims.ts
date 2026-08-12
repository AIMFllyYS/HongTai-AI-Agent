import type { ContentAnalysisInput } from "../contracts/content-analysis";
import type { ContentAnalysisHookDrivers, ContentAnalysisOverview } from "../schemas/content-analysis";
import { contentAnalysisStructureClaimsJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_STRUCTURE_CLAIMS_PROMPT_VERSION = "content-analysis.structure-claims.v1";

const contract = `严格匹配此Schema：${JSON.stringify(contentAnalysisStructureClaimsJsonSchema)}`;

export function contentAnalysisStructureClaimsPrompt(
  input: ContentAnalysisInput,
  overview: ContentAnalysisOverview,
  hookDrivers: ContentAnalysisHookDrivers,
): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n只生成structure和coreClaims。已校验前置模块：${JSON.stringify({ ...overview, ...hookDrivers })}\n证据单元：${contentEvidence(input)}`;
}

export function contentAnalysisStructureClaimsRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n校正本模块格式和证据引用，不新增证据。合法证据ID：${input.evidenceUnits.map((item) => item.id).join(",")}\n原始响应：${raw.slice(0, 16_000)}`;
}
