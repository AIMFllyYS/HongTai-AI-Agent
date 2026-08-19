import type { AssetInsightInput } from "../contracts/asset-insight";
import { ASSET_INSIGHT_BOUNDS, assetInsightResponseJsonSchema } from "../schemas/asset-insight";

export const ASSET_INSIGHT_PROMPT_VERSION = "asset-insight.v1";

const RULES = `你是手机端短视频素材审阅助手。看用户自己拍的图片或视频帧，只说画面里确实看得见的东西。
只输出JSON对象，不要Markdown、thinking标签或JSON以外的内容。
只描述能看见的：主体是什么、在做什么、大致环境、画面质量。
不得猜测品牌、店名、地名、人物身份或姓名、价格、日期，也不得推断画面外发生了什么。
不得输出健康判断、疾病、疗效、功效或任何医疗结论；不得写营销话术或夸赞。
画面太暗、太模糊、严重抖动、几乎空白或看不出主体时，usable必须为false并在unusableReason里说明要重拍什么。
usable为true时unusableReason必须为null。
tags只写单词，不写句子，不重复。`;

function bounds(): string {
  return `边界：描述最多${ASSET_INSIGHT_BOUNDS.maxDescriptionCharacters}字；tags最多${ASSET_INSIGHT_BOUNDS.maxTags}个，每个最多${ASSET_INSIGHT_BOUNDS.maxTagCharacters}字；unusableReason最多80字。`;
}

const CONTRACT = `输出逐字段匹配以下JSON Schema，不得增加包装层：\n${JSON.stringify(assetInsightResponseJsonSchema)}`;

/**
 * Says how many frames came from where, because "这些帧来自同一段视频" is the difference between
 * describing one subject and describing three unrelated stills.
 */
function framing(input: AssetInsightInput): string {
  return input.kind === "video"
    ? `以下${input.frames.length}张图是同一段视频按时间顺序抽的帧，请描述这段视频整体拍到了什么，若中途主体明显变化请在描述里说明。`
    : "以下是用户导入的一张图片，请描述这张图片拍到了什么。";
}

export function assetInsightPrompt(input: AssetInsightInput): string {
  return `${RULES}\n${bounds()}\n${CONTRACT}\n${framing(input)}`;
}

export function assetInsightRepairPrompt(raw: string, input: AssetInsightInput): string {
  return `${RULES}\n${bounds()}\n${CONTRACT}\n下面结果不符合Schema或上述边界。只修复这份描述，不要新增字段，也不要改变你实际看到的内容。\n${framing(input)}\n原始响应：${raw.slice(0, 8_000)}`;
}
