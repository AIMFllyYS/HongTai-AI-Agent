import type { ProductionPlanInput } from "../contracts/production-planning";
import { productionPlanResultJsonSchema } from "../schemas/production-plan";

const RULES = `你是手机端短视频制作规划助手。根据正式内容拆解、用户经营需求和用户主动导入的素材，生成可由本地渲染器直接执行的计划。
只输出production-plan.v1 JSON对象，不要Markdown、thinking标签或JSON以外的内容。
只允许引用素材清单中的assetId。不得照抄原作品措辞、虚构经营事实、医疗功效或无法验证的承诺。
镜头order必须从1连续递增；镜头durationSeconds之和必须等于settings.durationSeconds和目标时长。
首版固定720x1280、30fps、zh-CN系统语音；背景音乐只能引用audio素材，未提供时必须为null且音量为0。`;

const CONTRACT = `输出逐字段匹配以下JSON Schema，不得增加包装层：\n${JSON.stringify(productionPlanResultJsonSchema)}`;

export function productionPlanningPrompt(input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? "当前是数字人口播模式：只使用role为avatar的单个视频；保留其原始口播声音，不生成TTS或背景音乐。目标时长不得超过该视频时长；必须按用户提供的口播稿顺序切分镜头，caption与narration均不得偏离这份口播稿。"
    : "当前是素材剪辑模式：使用图片/视频作为视觉素材，为每个镜头写可由zh-CN系统TTS朗读的旁白；字幕应与旁白一致或忠实概括。";
  return `${RULES}\n${modeRules}\n${CONTRACT}\n真实来源和需求：${JSON.stringify({ analysisTaskId: input.analysisTaskId, brief: input.brief, targetDurationSeconds: input.targetDurationSeconds, mode: input.mode, ...(input.avatarScript ? { avatarScript: input.avatarScript } : {}) })}\n正式拆解：${JSON.stringify(input.analysis)}\n可用素材：${JSON.stringify(input.assets)}`;
}

export function productionPlanningRepairPrompt(raw: string, input: ProductionPlanInput): string {
  const modeRules = input.mode === "avatar"
    ? `数字人口播模式：只能引用role为avatar的单个视频，保留原声，backgroundMusicAssetId必须为null且backgroundMusicVolume必须为0。口播稿：${input.avatarScript ?? ""}`
    : "素材剪辑模式：每条narration都会由zh-CN系统TTS朗读。";
  return `${RULES}\n${modeRules}\n${CONTRACT}\n下面结果不符合Schema或执行约束。只修复计划，不新增素材。\n真实任务ID：${input.analysisTaskId}\n目标时长：${input.targetDurationSeconds}\n合法素材：${JSON.stringify(input.assets)}\n原始响应：${raw.slice(0, 32_000)}`;
}
