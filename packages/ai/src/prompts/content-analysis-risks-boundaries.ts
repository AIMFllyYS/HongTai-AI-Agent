import type { ContentAnalysisInput } from "../contracts/content-analysis";
import type {
  ContentAnalysisHookDrivers,
  ContentAnalysisOverview,
  ContentAnalysisStructureClaims,
  ContentAnalysisStyleTemplate,
} from "../schemas/content-analysis";
import { contentAnalysisRisksBoundariesJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_RISKS_BOUNDARIES_PROMPT_VERSION = "content-analysis.risks-boundaries.v1";

const contract = `严格匹配此Schema：${JSON.stringify(contentAnalysisRisksBoundariesJsonSchema)}`;

export function contentAnalysisRisksBoundariesPrompt(
  input: ContentAnalysisInput,
  prior: ContentAnalysisOverview & ContentAnalysisHookDrivers & ContentAnalysisStructureClaims & ContentAnalysisStyleTemplate,
): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n只生成risks。已校验前置模块：${JSON.stringify(prior)}\n证据单元：${contentEvidence(input)}`;
}

export function contentAnalysisRisksBoundariesRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n校正风险模块格式和证据引用，不新增证据。合法证据ID：${input.evidenceUnits.map((item) => item.id).join(",")}\n原始响应：${raw.slice(0, 16_000)}`;
}
