import type { ContentAnalysisInput } from "../contracts/content-analysis";
import { contentAnalysisResultJsonSchema } from "../schemas/content-analysis";

const RULES = `你是短视频与图文内容结构拆解助手。只根据提供的证据单元分析，不补充外部事实。
正式结果必须是content-analysis.v1 JSON对象，不要Markdown代码块，不要thinking标签，不要输出JSON以外的内容。
所有钩子、痛点、情绪、结构、观点和风险必须通过evidenceRefs引用真实证据ID。抽象可复用结构，不鼓励复制原作者的具体表达。
对医疗功效、夸大宣传、缺乏证据和高度模仿风险进行审慎标注。`;

const RESULT_CONTRACT = `输出必须逐字段严格匹配以下JSON Schema，不得改名、增加包装层或省略必填字段：\n${JSON.stringify(contentAnalysisResultJsonSchema)}`;

export function contentAnalysisPrompt(input: ContentAnalysisInput): string {
  return `${RULES}\n${RESULT_CONTRACT}\n任务来源：${JSON.stringify({ taskId: input.taskId, platform: input.platform, contentType: input.contentType, sourceKind: input.sourceKind })}\n标题和作者不属于内容证据，不得据此生成结论。\n证据单元：${JSON.stringify(input.evidenceUnits)}`;
}

export function contentAnalysisRepairPrompt(raw: string, input: ContentAnalysisInput): string {
  return `${RULES}\n${RESULT_CONTRACT}\n下面结果格式、来源或证据引用无效。只修复JSON及引用关系，不新增证据。\n真实来源：${JSON.stringify({ taskId: input.taskId, platform: input.platform, contentType: input.contentType, sourceKind: input.sourceKind })}\n合法证据ID：${input.evidenceUnits.map((item) => item.id).join(",")}\n原始响应：${raw.slice(0, 32_000)}`;
}
