import type { ContentAnalysisInput } from "../contracts/content-analysis";
import type { ContentAnalysisOverview } from "../schemas/content-analysis";
import { contentAnalysisHookDriversJsonSchema } from "../schemas/content-analysis";
import { CONTENT_ANALYSIS_COMMON_RULES, contentEvidence } from "./content-analysis-common";

export const CONTENT_ANALYSIS_HOOK_DRIVERS_PROMPT_VERSION = "content-analysis.hook-drivers.v1";

const contract = `严格匹配此Schema：${JSON.stringify(contentAnalysisHookDriversJsonSchema)}`;

export function contentAnalysisHookDriversPrompt(input: ContentAnalysisInput, overview: ContentAnalysisOverview): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n只生成hook、painPoints和emotionalDrivers。已校验概览：${JSON.stringify(overview)}\n证据单元：${contentEvidence(input)}`;
}

export function contentAnalysisHookDriversRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${CONTENT_ANALYSIS_COMMON_RULES}\n${contract}\n校正本模块格式和证据引用，不新增证据。合法证据ID：${input.evidenceUnits.map((item) => item.id).join(",")}\n原始响应：${raw.slice(0, 16_000)}`;
}
