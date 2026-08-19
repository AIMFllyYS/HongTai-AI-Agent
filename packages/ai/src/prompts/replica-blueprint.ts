import type { ReplicaBlueprintInput } from "../contracts/replica-blueprint";
import { REPLICA_BLUEPRINT_BOUNDS, replicaBlueprintResponseJsonSchema } from "../schemas/replica-blueprint";

export const REPLICA_BLUEPRINT_PROMPT_VERSION = "replica-blueprint-single.v1";

const RULES = `你是手机端爆款复刻筹备助手。根据正式内容拆解和真实证据单元，输出用户自己重新拍摄这条内容所需要的分镜与素材清单。
只输出要求的单个JSON对象，不要Markdown代码块、thinking标签或JSON以外的文字。
每个分镜的evidenceRefs只能引用输入证据单元中真实存在的id，且至少一条；推不出画面的分镜必须直接不写，不要用常识、标题、作者或外部知识补画面。
证据不足以支撑任何一个分镜时，shots必须为空数组，并在emptyReason里说明缺什么证据。
visualDescription只描述用户能自己拍到的画面；不得描述被拆解视频里的具体人物、门店、品牌或画面细节，也不得让用户去下载或翻拍原视频。
scriptDraft是用户口播的起草稿：可以吸收结构和说话节奏，不得照抄或近似改写原文句子。
subject只能在operator/customer/product/environment/document/other中选，不要编造具体身份。
不得输出疾病诊断、处方、概率、健康评分或医疗功效承诺；原拆解里的风险项应当规避而不是复述。`;

function bounds(): string {
  const { maxShots, minShotSeconds, maxShotSeconds, minTotalSeconds, maxTotalSeconds } = REPLICA_BLUEPRINT_BOUNDS;
  return `分镜最多${maxShots}个，order从1连续递增。每个素材建议时长是${minShotSeconds}到${maxShotSeconds}之间的整数秒；shots非空时全部建议时长之和必须在${minTotalSeconds}到${maxTotalSeconds}秒之间，因为成片只能落在这个区间。
suggestedTemplateId是整条视频统一的字幕模板；karaoke_glow需要逐字时间，本阶段拿不到，选它会被降级为逐行模板。`;
}

const CONTRACT = `输出逐字段匹配以下JSON Schema，不得增加包装层：`;

/** Only the fields a blueprint may lean on. The full breakdown carries risk and template copy the
 * model should not paraphrase into shots, and a smaller prompt keeps the citation set explicit. */
function analysisDigest(input: ReplicaBlueprintInput): string {
  const { overview, hook, painPoints, structure, coreClaims, style } = input.analysis;
  return JSON.stringify({ overview, hook, painPoints, structure, coreClaims, style });
}

function evidence(input: ReplicaBlueprintInput): string {
  return JSON.stringify(input.evidenceUnits);
}

export function replicaBlueprintPrompt(input: ReplicaBlueprintInput): string {
  return [
    RULES,
    bounds(),
    `${CONTRACT}\n${JSON.stringify(replicaBlueprintResponseJsonSchema)}`,
    `真实证据单元（唯一可引用的证据）：${evidence(input)}`,
    `正式爆款拆解（参考，不可照抄）：${analysisDigest(input)}`,
  ].join("\n");
}

export function replicaBlueprintRepairPrompt(raw: string, input: ReplicaBlueprintInput): string {
  return [
    RULES,
    bounds(),
    `${CONTRACT}\n${JSON.stringify(replicaBlueprintResponseJsonSchema)}`,
    "下面结果不符合Schema、证据引用或原创性约束。只修复这份清单，不要新增证据，也不要为了凑满分镜而编造画面。",
    `合法证据id：${JSON.stringify(input.evidenceUnits.map((unit) => unit.id))}`,
    `正式爆款拆解（参考，不可照抄）：${analysisDigest(input)}`,
    `原始响应：${raw.slice(0, 20_000)}`,
  ].join("\n");
}
