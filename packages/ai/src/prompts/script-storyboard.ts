import {
  DECORATION_CATALOGUE,
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SCRIPT_SENTENCE_CHARACTERS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_PRODUCTION_DURATION_SECONDS,
  SCRIPT_SENTENCE_MS_PER_CHARACTER,
} from "@hongtai/core";

import type { ScriptGenerationAsset, ScriptGenerationInput } from "../contracts/script-storyboard-generation";
import { scriptStoryboardDraftJsonSchema } from "../schemas/script-storyboard";

const RULES = `你是手机端短视频分镜脚本撰写助手，服务大健康门店（养生、推拿、艾灸、足浴、健康食品零售等）的经营者。
根据用户的一句话需求（以及可选的参考拆解与素材画面识别结果），撰写逐句口播分镜脚本。
只输出一个JSON对象，包含purpose（可选）与sentences数组，不要Markdown、thinking标签或JSON以外的内容。
每个sentences条目只包含text、assetId（可选）、stickerId（可选）三个字段，不要输出id、时长或毫秒数。
每句text是一句完整、自然、可直接朗读的中文口播，不超过${MAX_SCRIPT_SENTENCE_CHARACTERS}个字符，句与句连起来是一条完整的短视频文稿。
分镜句数不超过${MAX_SHOTS_PER_PRODUCTION}句。口播时长不由你决定：系统按每字约${SCRIPT_SENTENCE_MS_PER_CHARACTER / 1_000}秒估算，请按口播节奏自然组织句子。
不得虚构经营事实、顾客评价、价格优惠或疗效；不做疾病诊断、治疗承诺、医疗功效或无法验证的表述。`;

function modeRules(input: ScriptGenerationInput): string {
  if (input.mode === "avatar") {
    const avatar = avatarAsset(input);
    const binding = avatar ? `每一句的assetId都必须逐字等于该数字人视频的素材id「${avatar.id}」` : "每一句的assetId都必须逐字等于该数字人视频的素材id";
    return `当前是数字人模式：用户上传一段数字人出镜视频，配音、字幕与画面裁剪拼接全部由系统自动完成，口播时长不受该视频长度约束。按每字约${SCRIPT_SENTENCE_MS_PER_CHARACTER / 1_000}秒估算，全部句子的估算总时长建议落在${MIN_PRODUCTION_DURATION_SECONDS}到${MAX_PRODUCTION_DURATION_SECONDS}秒之间（软边界，允许就近），句数不超过${MAX_SHOTS_PER_PRODUCTION}句；${binding}。`;
  }
  return `当前是素材剪辑模式：按每字约${SCRIPT_SENTENCE_MS_PER_CHARACTER / 1_000}秒估算，全部句子的估算总时长建议落在${MIN_PRODUCTION_DURATION_SECONDS}到${MAX_PRODUCTION_DURATION_SECONDS}秒之间（软边界，允许就近），句数不超过${MAX_SHOTS_PER_PRODUCTION}句。`;
}

function avatarAsset(input: ScriptGenerationInput): ScriptGenerationAsset | undefined {
  return (input.assets ?? []).find((asset) => asset.role === "avatar" && asset.kind === "video");
}

/**
 * The reference analysis is optional by design (拆解不再是建项目的前置)：present when the user
 * picked one, plainly absent otherwise. Structure and pacing may be absorbed; wording may not.
 */
function analysisRules(input: ScriptGenerationInput): string {
  if (!input.analysis) {
    return "本次没有参考拆解结果：直接依据用户的一句话需求与素材撰写原创口播，不得虚构不存在的参考来源。";
  }
  return `以下参考拆解仅供结构与思路参考：可以吸收节奏、钩子和表达框架，不得把拆解中的句子当作本次口播内容，不得照抄或近似改写。参考拆解：${JSON.stringify(input.analysis)}`;
}

/**
 * Assets carrying an `insight` were actually looked at, so their sentences may name what is in
 * the frame. Assets without one were not, and the model has to be told that plainly.
 */
function assetRules(input: ScriptGenerationInput): string {
  const assets = input.assets ?? [];
  if (input.mode === "avatar") {
    return `素材清单：${JSON.stringify(assets.map((asset) => ({ id: asset.id, kind: asset.kind, role: asset.role })))}。数字人模式下只引用数字人视频素材。`;
  }
  if (assets.length === 0) {
    return "本次没有可用素材清单：sentences条目一律不写assetId字段，也不得描述任何具体画面内容。";
  }
  const described = assets.filter((asset) => asset.insight !== undefined);
  if (described.length === 0) {
    return `没有任何素材的画面被识别过：assetId只能从下列清单中选择，无合适素材时不写assetId字段，不得编造素材id，也不得描述任何具体画面内容。素材清单：${JSON.stringify(assets.map((asset) => ({ id: asset.id, kind: asset.kind, role: asset.role })))}`;
  }
  const blind = assets.filter((asset) => asset.role === "visual" && asset.insight === undefined);
  const blindRule = blind.length === 0
    ? ""
    : `\n以下素材没有画面识别结果，为它们写的句子不得描述具体画面内容：${JSON.stringify(blind.map((asset) => asset.id))}`;
  return `部分素材带有insight字段，那是系统对该素材真实画面的识别结果。绑定建议只能从下列清单中选择，无合适素材时不写assetId字段，不得编造素材id；为带有insight的素材写句子时只能讲insight里确实提到的东西，不得补充insight没有提到的人物、物品、品牌、地点或数字。素材清单：${JSON.stringify(assets.map((asset) => ({ id: asset.id, kind: asset.kind, role: asset.role, ...(asset.insight ? { insight: asset.insight } : {}) })))}${blindRule}`;
}

/** Catalogue ids only; the sticker is a suggestion recorded on the sentence, never a timestamp. */
function stickerRules(): string {
  const catalogue = DECORATION_CATALOGUE.map((item) => ({ id: item.id, label: item.label, tags: item.tags }));
  return `stickerId从下列内置贴纸中选择，不需要贴纸时省略该字段，不得自造文件名、路径或未列出的id。可选贴纸：${JSON.stringify(catalogue)}`;
}

const CONTRACT = `输出逐字段匹配以下JSON Schema，不得增加包装层：\n${JSON.stringify(scriptStoryboardDraftJsonSchema)}`;

export function scriptStoryboardPrompt(input: ScriptGenerationInput): string {
  return `${RULES}\n${modeRules(input)}\n${analysisRules(input)}\n${assetRules(input)}\n${stickerRules()}\n${CONTRACT}\n用户的一句话需求：${JSON.stringify(input.brief)}`;
}

export function scriptStoryboardRepairPrompt(raw: string, input: ScriptGenerationInput): string {
  return `${RULES}\n${modeRules(input)}\n${analysisRules(input)}\n${assetRules(input)}\n${stickerRules()}\n${CONTRACT}\n下面结果不符合Schema或执行约束。只修复分镜脚本，不新增素材。\n用户的一句话需求：${JSON.stringify(input.brief)}\n原始响应：${raw.slice(0, 32_000)}`;
}
