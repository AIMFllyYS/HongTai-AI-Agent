import { DECORATION_CATALOGUE } from "@hongtai/core";

import type { ProductionPlanInput } from "../contracts/production-planning";
import { MAX_DECORATIONS_PER_PLAN, MAX_DECORATIONS_PER_SHOT } from "../schemas/production-plan-overlays";
import { productionPlanResultJsonSchema } from "../schemas/production-plan";

const RULES = `你是手机端短视频制作规划助手。根据正式内容拆解、用户经营需求和用户主动导入的素材，生成可由本地渲染器直接执行的计划。
只输出一个JSON对象，schemaVersion必须是production-plan.v2，并额外给出decorationSelections数组，不要Markdown、thinking标签或JSON以外的内容。
只允许引用素材清单中的assetId。不得照抄原作品措辞、虚构经营事实、医疗功效或无法验证的承诺。
镜头order必须从1连续递增；镜头durationSeconds之和必须等于settings.durationSeconds和目标时长。
首版固定720x1280、30fps、zh-CN系统语音；背景音乐只能引用audio素材，未提供时必须为null且音量为0。
textOverlay必须生成简短中文主文字；用户填写主文字时primaryText必须逐字使用该值，preset必须逐字使用用户选择的预设。`;

const REFERENCE_PREFIX = `以下爆款原文与拆解仅供创作参考。可以吸收结构、节奏、钩子和表达思路，但不得把原文或拆解中的句子当作本次口播内容，不得照抄、近似改写或冒充原作者表达。必须依据用户真实需求重新组织原创口播。`;

const CONTRACT = `输出逐字段匹配以下JSON Schema，不得增加包装层：\n${JSON.stringify(productionPlanResultJsonSchema)}`;

/**
 * Assets carrying a `requirement` came from a checklist the user filmed against, so their order is
 * data, not a preference. Saying so up front keeps the planner from spending a repair round
 * discovering it.
 */
function requirementRules(input: ProductionPlanInput): string {
  const bound = input.assets
    .filter((asset) => asset.requirement !== undefined)
    .sort((left, right) => (left.requirement?.order ?? 0) - (right.requirement?.order ?? 0));
  if (bound.length === 0) return "";
  const list = bound.map((asset, index) => ({
    shotOrder: index + 1,
    assetId: asset.id,
    画面意图: asset.requirement?.visualDescription,
    素材说明: asset.requirement?.contentHint,
    建议秒数: asset.requirement?.suggestedDurationSeconds,
  }));
  return `用户是按素材需求清单逐项拍摄的，镜头必须严格按下表使用素材：共${bound.length}个镜头，第shotOrder个镜头的assetId必须逐字等于表中对应值，不得增删镜头、不得换顺序、不得让一个素材出现在两个镜头。建议秒数只是清单参考，实际镜头时长仍必须之和精确等于目标时长；用户跳过的清单项已不在表中，其时长由剩下的镜头吸收。每个镜头的口播和字幕要贴合该镜头的画面意图。\n镜头素材对应表：${JSON.stringify(list)}`;
}

/**
 * Assets carrying an `insight` were actually looked at, so their narration may name what is in the
 * frame. Assets without one were not, and the planner has to be told that plainly: given a mixed
 * list it will otherwise describe the undescribed pictures with the same confidence.
 */
function insightRules(input: ProductionPlanInput): string {
  // Avatar captions must follow the user's own script word for word. Adding "do not describe any
  // picture" on top of that contradicts the script whenever it happens to mention what is on screen,
  // and the script wins: the recorded voice already said it.
  if (input.mode === "avatar") return "";
  const described = input.assets.filter((asset) => asset.insight !== undefined);
  if (described.length === 0) {
    return "没有任何素材的画面被识别过。旁白和字幕只能讲用户的经营需求与拆解结构，不得描述任何具体画面内容，不得声称画面里有某个人、某件物品或某个场景。";
  }
  const blind = input.assets.filter((asset) => asset.role === "visual" && asset.insight === undefined);
  const blindRule = blind.length === 0
    ? ""
    : `\n以下素材没有画面识别结果，为它们写的旁白不得描述具体画面内容：${JSON.stringify(blind.map((asset) => asset.id))}`;
  return `部分素材带有insight字段，那是系统对该素材真实画面的识别结果。为这些镜头写旁白和字幕时，只能讲insight里确实提到的东西，不得补充insight没有提到的人物、物品、品牌、地点或数字。insight与拆解内容冲突时以insight为准，因为画面是用户真正拍到的。${blindRule}`;
}

/**
 * Catalogue ids and density only. Timestamps are assembled locally from cues; asking the model
 * for milliseconds produced numbers that did not add up.
 */
function decorationRules(input: ProductionPlanInput): string {
  const allowed = new Set(input.allowedDecorationIds ?? []);
  if (allowed.size === 0) {
    return "decorationSelections必须是空数组。当前没有开放任何贴纸，不得自造文件名或贴纸id。";
  }
  const catalogue = DECORATION_CATALOGUE
    .filter((item) => allowed.has(item.id))
    .map((item) => ({ id: item.id, label: item.label, tags: item.tags }));
  return [
    `decorationSelections从下列内置贴纸中挑选，assetRef必须逐字等于表中id，不得自造文件名、路径或未列出的id。`,
    `整片最多${MAX_DECORATIONS_PER_PLAN}个，每个镜头最多${MAX_DECORATIONS_PER_SHOT}个；不需要装饰时输出空数组。`,
    `只选择镜头shotOrder、贴纸id、锚点anchor、scale（0.5到2）和animation。animation只能是none、fade、pop、float四种，不要承诺描边动画、序列帧或粒子。`,
    `不要填写startMs、endMs或文件路径，时间轴由系统按该镜字幕推导。`,
    `可选贴纸：${JSON.stringify(catalogue)}`,
  ].join("");
}

export function productionPlanningPrompt(input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? "当前是数字人口播模式：只使用role为avatar的单个视频；保留其原始口播声音，不生成TTS或背景音乐。目标时长不得超过该视频时长；必须按用户提供的口播稿顺序切分镜头，caption与narration均不得偏离这份口播稿。"
    : "当前是素材剪辑模式：使用图片/视频作为视觉素材，为每个镜头写可由zh-CN系统TTS朗读的旁白；字幕应与旁白一致或忠实概括。";
  return `${RULES}\n${modeRules}\n${requirementRules(input)}\n${insightRules(input)}\n${decorationRules(input)}\n${CONTRACT}\n${REFERENCE_PREFIX}\n真实来源和需求：${JSON.stringify({ analysisTaskId: input.analysisTaskId, brief: input.brief, targetDurationSeconds: input.targetDurationSeconds, mode: input.mode, headlineText: input.headlineText ?? null, textPreset: input.textPreset, ...(input.avatarScript ? { avatarScript: input.avatarScript } : {}) })}\n爆款原文（参考，不可作为口播）：${input.originalSourceText}\n正式爆款拆解（参考，不可照抄）：${JSON.stringify(input.analysis)}\n可用素材：${JSON.stringify(input.assets)}`;
}

export function productionPlanningRepairPrompt(raw: string, input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? `数字人口播模式：只能引用role为avatar的单个视频，保留原声，backgroundMusicAssetId必须为null且backgroundMusicVolume必须为0。口播稿：${input.avatarScript ?? ""}`
    : "素材剪辑模式：每条narration都会由zh-CN系统TTS朗读。";
  return `${RULES}\n${modeRules}\n${requirementRules(input)}\n${insightRules(input)}\n${decorationRules(input)}\n${CONTRACT}\n${REFERENCE_PREFIX}\n下面结果不符合Schema、原创性或执行约束。只修复计划，不新增素材。\n真实任务ID：${input.analysisTaskId}\n目标时长：${input.targetDurationSeconds}\n主文字：${input.headlineText ?? "由模型生成"}\n文字预设：${input.textPreset}\n爆款原文（参考，不可作为口播）：${input.originalSourceText}\n正式爆款拆解（参考，不可照抄）：${JSON.stringify(input.analysis)}\n合法素材：${JSON.stringify(input.assets)}\n原始响应：${raw.slice(0, 32_000)}`;
}
