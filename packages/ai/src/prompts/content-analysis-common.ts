import type { ContentAnalysisInput } from "../contracts/content-analysis";

export const CONTENT_ANALYSIS_COMMON_RULES = `你是短视频与图文内容结构拆解助手。只根据提供的真实证据单元分析，不补充标题、作者、外部事实或常识作为内容证据。
只输出当前模块要求的JSON对象，不要Markdown代码块、thinking标签或JSON以外的文字。
任何evidenceRefs都只能引用输入中的真实证据ID；证据不足时允许使用空数组并明确说明证据不足。
抽象可复用结构，不鼓励复制原作者具体表达；审慎识别医疗功效、夸大宣传、无依据结论和高度模仿风险。`;

export function contentEvidence(input: ContentAnalysisInput): string {
  return JSON.stringify(input.evidenceUnits);
}
