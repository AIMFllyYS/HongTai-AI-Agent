import { TaskError } from "@hongtai/core";

import type { ProductionPlanInput, ProductionPlanningFlowDependencies } from "../../contracts/production-planning";
import { productionPlanningPrompt, productionPlanningRepairPrompt } from "../../prompts/production-planning";
import { productionPlanResultJsonSchema, productionPlanResultV2Schema, type ProductionPlanResultV2 } from "../../schemas/production-plan";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

function invalid(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

function validateInput(input: ProductionPlanInput): void {
  if (input.targetDurationSeconds < 15 || input.targetDurationSeconds > 60) throw invalid("制作目标时长必须在15到60秒之间");
  if (input.assets.length === 0 || input.assets.length > 12) throw invalid("制作素材数量必须在1到12个之间");
  if (!input.brief.trim()) throw invalid("制作需求不能为空");
  if (!input.originalSourceText.trim() || input.originalSourceText.length > 12_000) throw invalid("爆款原文必须在1到12000字符之间");
  if (input.headlineText !== undefined && (!input.headlineText.trim() || input.headlineText.trim().length > 24)) throw invalid("主文字必须在1到24字符之间");
  if (input.analysis.source.taskId !== input.analysisTaskId) throw invalid("正式拆解与制作来源任务不一致");
  if (input.mode === "montage" && input.assets.length < 3) throw invalid("素材剪辑模式至少需要3个制作素材");
  if (input.mode === "avatar") {
    if (!input.avatarScript?.trim()) throw invalid("数字人口播模式需要填写与视频一致的口播稿");
    const avatars = input.assets.filter((asset) => asset.role === "avatar" && asset.kind === "video");
    if (avatars.length !== 1) throw invalid("数字人口播模式需要且只能使用一个数字人口播视频");
    if (avatars[0]?.durationSeconds === undefined || avatars[0].durationSeconds + 0.001 < input.targetDurationSeconds) {
      throw invalid("数字人口播视频时长不足，请选择更长的视频或缩短目标时长");
    }
  }
}

function normalizedCopy(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[^\p{Letter}\p{Number}]/gu, "");
}

export function assertOriginalNarration(result: ProductionPlanResultV2, input: ProductionPlanInput): void {
  if (input.mode !== "montage") return;
  const original = normalizedCopy(input.originalSourceText);
  const narration = normalizedCopy(result.shots.map((shot) => shot.narration).join(""));
  if (original.length < 12 || narration.length < 12) return;
  for (let index = 0; index <= narration.length - 12; index += 1) {
    if (original.includes(narration.slice(index, index + 12))) throw invalid("制作口播与参考原文存在连续重复，请重新组织原创表达");
  }
}

function validatePlan(result: ProductionPlanResultV2, input: ProductionPlanInput): void {
  if (result.source.analysisTaskId !== input.analysisTaskId) throw invalid("制作计划来源与真实拆解任务不一致");
  if (result.settings.durationSeconds !== input.targetDurationSeconds) throw invalid("制作计划时长与目标时长不一致");
  if (result.shots.some((shot, index) => shot.order !== index + 1)) throw invalid("制作计划镜头顺序不连续");
  const total = result.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  if (Math.abs(total - result.settings.durationSeconds) > 0.01) throw invalid("制作计划镜头总时长不一致");
  const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
  if (result.shots.some((shot) => !assets.has(shot.assetId))) throw invalid("制作计划引用了不存在的素材");
  const musicId = result.audio.backgroundMusicAssetId;
  if (musicId !== null && assets.get(musicId)?.kind !== "audio") throw invalid("背景音乐必须引用已导入的音频素材");
  if (musicId === null && result.audio.backgroundMusicVolume !== 0) throw invalid("没有背景音乐时音量必须为0");
  if (result.textOverlay.preset !== input.textPreset) throw invalid("制作计划文字预设与用户选择不一致");
  if (input.headlineText && result.textOverlay.primaryText !== input.headlineText.trim()) throw invalid("制作计划没有逐字使用用户填写的主文字");
  assertOriginalNarration(result, input);
  if (input.mode === "avatar") {
    const avatarId = input.assets.find((asset) => asset.role === "avatar")?.id;
    if (!avatarId || result.shots.some((shot) => shot.assetId !== avatarId)) throw invalid("数字人口播计划只能使用上传的数字人视频");
    if (musicId !== null || result.audio.backgroundMusicVolume !== 0) throw invalid("数字人口播模式保留原视频声音，不能叠加背景音乐");
  }
}

export class ProductionPlanningFlow {
  readonly #dependencies: ProductionPlanningFlowDependencies;

  constructor(dependencies: ProductionPlanningFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: ProductionPlanInput): Promise<ProductionPlanResultV2> {
    validateInput(input);
    const request = async (prompt: string) => this.#dependencies.provider.generate({
      model: "text",
      output: "json",
      jsonSchema: { name: "production_plan_v2", schema: productionPlanResultJsonSchema, strict: true },
      messages: [{ role: "system", content: prompt }],
      ...(this.#dependencies.onEvent ? { onEvent: this.#dependencies.onEvent } : {}),
    });
    const initial = await request(productionPlanningPrompt(input));
    try {
      const result = parseStructuredOutput(initial.content, productionPlanResultV2Schema);
      validatePlan(result, input);
      return result;
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
      const repaired = await request(productionPlanningRepairPrompt(initial.content, input));
      try {
        const result = parseStructuredOutput(repaired.content, productionPlanResultV2Schema);
        validatePlan(result, input);
        return result;
      } catch (repairError) {
        throw new TaskError({ code: "AI_FORMAT_REPAIR_FAILED", message: "制作计划修复后仍不符合执行约束", action: "retry", cause: repairError });
      }
    }
  }
}
