import type { ProductionPlanInput } from "../contracts/production-planning";
import { productionPlanResultJsonSchema } from "../schemas/production-plan";

const RULES = `你是手机端短视频制作规划助手。根据正式内容拆解、用户经营需求和用户主动导入的素材，生成可由本地渲染器直接执行的计划。
只输出production-plan.v2 JSON对象，不要Markdown、thinking标签或JSON以外的内容。
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

export function productionPlanningPrompt(input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? "当前是数字人口播模式：只使用role为avatar的单个视频；保留其原始口播声音，不生成TTS或背景音乐。目标时长不得超过该视频时长；必须按用户提供的口播稿顺序切分镜头，caption与narration均不得偏离这份口播稿。"
    : "当前是素材剪辑模式：使用图片/视频作为视觉素材，为每个镜头写可由zh-CN系统TTS朗读的旁白；字幕应与旁白一致或忠实概括。";
  return `${RULES}\n${modeRules}\n${requirementRules(input)}\n${CONTRACT}\n${REFERENCE_PREFIX}\n真实来源和需求：${JSON.stringify({ analysisTaskId: input.analysisTaskId, brief: input.brief, targetDurationSeconds: input.targetDurationSeconds, mode: input.mode, headlineText: input.headlineText ?? null, textPreset: input.textPreset, ...(input.avatarScript ? { avatarScript: input.avatarScript } : {}) })}\n爆款原文（参考，不可作为口播）：${input.originalSourceText}\n正式爆款拆解（参考，不可照抄）：${JSON.stringify(input.analysis)}\n可用素材：${JSON.stringify(input.assets)}`;
}

export function productionPlanningRepairPrompt(raw: string, input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? `数字人口播模式：只能引用role为avatar的单个视频，保留原声，backgroundMusicAssetId必须为null且backgroundMusicVolume必须为0。口播稿：${input.avatarScript ?? ""}`
    : "素材剪辑模式：每条narration都会由zh-CN系统TTS朗读。";
  return `${RULES}\n${modeRules}\n${requirementRules(input)}\n${CONTRACT}\n${REFERENCE_PREFIX}\n下面结果不符合Schema、原创性或执行约束。只修复计划，不新增素材。\n真实任务ID：${input.analysisTaskId}\n目标时长：${input.targetDurationSeconds}\n主文字：${input.headlineText ?? "由模型生成"}\n文字预设：${input.textPreset}\n爆款原文（参考，不可作为口播）：${input.originalSourceText}\n正式爆款拆解（参考，不可照抄）：${JSON.stringify(input.analysis)}\n合法素材：${JSON.stringify(input.assets)}\n原始响应：${raw.slice(0, 32_000)}`;
}
