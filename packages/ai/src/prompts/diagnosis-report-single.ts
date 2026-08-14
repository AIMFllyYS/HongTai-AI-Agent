import type { ObservationMode } from "../schemas/diagnosis-report";
import { diagnosisSingleResponseJsonSchema } from "../schemas/diagnosis-report";
import { FIVE_ORGANS_OBSERVATION_KNOWLEDGE } from "../knowledge/five-organs-observation.generated";
import { DIAGNOSIS_COMMON_RULES } from "./diagnosis-common";

export const DIAGNOSIS_SINGLE_PROMPT_VERSION = "diagnosis-single-stream.v2";

const compactContract = `输出必须严格匹配这个紧凑Schema：${JSON.stringify(diagnosisSingleResponseJsonSchema)}`;

export function diagnosisSinglePrompt(mode: ObservationMode): string {
  return `${DIAGNOSIS_COMMON_RULES}
你只有一次图片分析任务。观察${mode === "tongue" ? "舌部" : "面部"}图片后，按quality、observation、summary、wellnessReference、advice、safety、followUp顺序输出一个JSON对象。
${compactContract}
observation只写图片中直接可见的内容；summary做简短归纳；wellnessReference只写传统观察中的不确定关联，并明确单张图片不能据此诊断；advice只给日常记录与生活方式建议；safety说明限制和需要咨询专业人员的情况；followUp最多一个必要问题。
不能把齿痕直接等同于湿气重，不能把白苔直接等同于胃寒，不能把舌红直接等同于心火旺；必须按知识上下文中的组合条件和干扰因素表达。
如果图片不可用，quality必须为unusable，observation、wellnessReference和advice必须为空字符串，其余字段只写重拍、限制、安全提醒与必要追问。不要生成ID、分类、版本号、免责声明或嵌套数组。

以下 Markdown 是本次唯一允许使用的传统观察知识上下文；不得补充其中没有的脏腑映射、疾病或治疗知识：
${FIVE_ORGANS_OBSERVATION_KNOWLEDGE}`;
}

export function diagnosisSingleRepairPrompt(raw: string, mode: ObservationMode): string {
  return `${diagnosisSinglePrompt(mode)}
校正下面响应的JSON格式与安全边界，只保留六个规定字段，不新增图片中不可见的结论：
${raw.slice(0, 12_000)}`;
}
