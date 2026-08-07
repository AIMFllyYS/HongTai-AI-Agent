import { TaskError } from "@hongtai/core";

import type { ProductionPlanInput, ProductionPlanningFlowDependencies } from "../../contracts/production-planning";
import { productionPlanningPrompt, productionPlanningRepairPrompt } from "../../prompts/production-planning";
import { productionPlanResultJsonSchema, productionPlanResultSchema, type ProductionPlanResultV1 } from "../../schemas/production-plan";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

function invalid(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

function validateInput(input: ProductionPlanInput): void {
  if (input.targetDurationSeconds < 15 || input.targetDurationSeconds > 60) throw invalid("制作目标时长必须在15到60秒之间");
  if (input.assets.length < 3 || input.assets.length > 12) throw invalid("制作素材数量必须在3到12个之间");
  if (!input.brief.trim()) throw invalid("制作需求不能为空");
  if (input.analysis.source.taskId !== input.analysisTaskId) throw invalid("正式拆解与制作来源任务不一致");
}

function validatePlan(result: ProductionPlanResultV1, input: ProductionPlanInput): void {
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
}

export class ProductionPlanningFlow {
  readonly #dependencies: ProductionPlanningFlowDependencies;

  constructor(dependencies: ProductionPlanningFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: ProductionPlanInput): Promise<ProductionPlanResultV1> {
    validateInput(input);
    const request = async (prompt: string) => this.#dependencies.provider.generate({
      model: "text",
      output: "json",
      jsonSchema: { name: "production_plan_v1", schema: productionPlanResultJsonSchema, strict: true },
      messages: [{ role: "system", content: prompt }],
      ...(this.#dependencies.onEvent ? { onEvent: this.#dependencies.onEvent } : {}),
    });
    const initial = await request(productionPlanningPrompt(input));
    try {
      const result = parseStructuredOutput(initial.content, productionPlanResultSchema);
      validatePlan(result, input);
      return result;
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
      const repaired = await request(productionPlanningRepairPrompt(initial.content, input));
      try {
        const result = parseStructuredOutput(repaired.content, productionPlanResultSchema);
        validatePlan(result, input);
        return result;
      } catch (repairError) {
        throw new TaskError({ code: "AI_FORMAT_REPAIR_FAILED", message: "制作计划修复后仍不符合执行约束", action: "retry", cause: repairError });
      }
    }
  }
}
