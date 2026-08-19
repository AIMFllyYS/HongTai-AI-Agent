import {
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_MONTAGE_VISUAL_ASSETS,
  MIN_PRODUCTION_DURATION_SECONDS,
  TaskError,
  type SubtitleTimingSource,
} from "@hongtai/core";

import type { ProductionPlanInput, ProductionPlanningFlowDependencies } from "../../contracts/production-planning";
import { productionPlanningPrompt, productionPlanningRepairPrompt } from "../../prompts/production-planning";
import {
  productionPlanResultJsonSchema,
  productionPlanResultV2Schema,
  type ProductionPlanGrounding,
  type ProductionPlanResultV2,
  type ProductionPlanResultV3,
} from "../../schemas/production-plan";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";
import { invalidPlan, validateProductionPlan, type ProductionPlanConstraints } from "./production-plan-validation";
import { withSubtitleTimeline } from "./production-subtitle-timeline";

/**
 * Narration is synthesized on device only after the plan is approved, so its real length is
 * unknown while planning. Cue boundaries are therefore proportional to the copy and the plan
 * says so rather than implying the subtitles were aligned to audio.
 */
const MONTAGE_TIMING_SOURCE: SubtitleTimingSource = "script_estimate";

/**
 * Reads how much of the material was actually described. Derived from the run rather than asked of
 * the model, so a plan cannot claim to have been grounded in pictures nobody opened.
 */
function groundingOf(input: ProductionPlanInput): ProductionPlanGrounding {
  // Avatar mode cuts the user's own script over their own recording, so there is no material to
  // match and describing it as blind would invite the export screen to warn about a non-problem.
  if (input.mode === "avatar") return { visual: "not_applicable", describedAssetIds: [] };
  const describedAssetIds = input.assets.filter((asset) => asset.insight !== undefined).map((asset) => asset.id);
  return describedAssetIds.length === 0
    ? { visual: "blind", describedAssetIds: [] }
    : { visual: "asset_insight", describedAssetIds };
}

function withDerivedCues(
  plan: ProductionPlanResultV2,
  requestedTemplateId: string | undefined,
  grounding: ProductionPlanGrounding,
): ProductionPlanResultV3 {
  return withSubtitleTimeline({
    plan,
    source: MONTAGE_TIMING_SOURCE,
    grounding,
    ...(requestedTemplateId === undefined ? {} : { requestedTemplateId }),
    invalid: (cause) => invalidPlan("制作计划无法生成可执行的字幕时间轴", cause),
  });
}

function validateInput(input: ProductionPlanInput): void {
  if (input.targetDurationSeconds < MIN_PRODUCTION_DURATION_SECONDS || input.targetDurationSeconds > MAX_PRODUCTION_DURATION_SECONDS) {
    throw invalidPlan("制作目标时长必须在15到60秒之间");
  }
  if (input.assets.length === 0 || input.assets.length > MAX_SHOTS_PER_PRODUCTION) throw invalidPlan("制作素材数量必须在1到12个之间");
  if (!input.brief.trim()) throw invalidPlan("制作需求不能为空");
  if (!input.originalSourceText.trim() || input.originalSourceText.length > 12_000) throw invalidPlan("爆款原文必须在1到12000字符之间");
  if (input.headlineText !== undefined && (!input.headlineText.trim() || input.headlineText.trim().length > 24)) throw invalidPlan("主文字必须在1到24字符之间");
  if (input.analysis.source.taskId !== input.analysisTaskId) throw invalidPlan("正式拆解与制作来源任务不一致");
  if (input.mode === "montage" && input.assets.length < MIN_MONTAGE_VISUAL_ASSETS) {
    throw invalidPlan(`素材剪辑模式至少需要${MIN_MONTAGE_VISUAL_ASSETS}个制作素材`);
  }
  if (input.mode === "avatar") {
    if (!input.avatarScript?.trim()) throw invalidPlan("数字人口播模式需要填写与视频一致的口播稿");
    const avatars = input.assets.filter((asset) => asset.role === "avatar" && asset.kind === "video");
    if (avatars.length !== 1) throw invalidPlan("数字人口播模式需要且只能使用一个数字人口播视频");
    if (avatars[0]?.durationSeconds === undefined || avatars[0].durationSeconds + 0.001 < input.targetDurationSeconds) {
      throw invalidPlan("数字人口播视频时长不足，请选择更长的视频或缩短目标时长");
    }
  }
}

export function planConstraintsFromInput(input: ProductionPlanInput): ProductionPlanConstraints {
  return {
    analysisTaskId: input.analysisTaskId,
    mode: input.mode,
    targetDurationSeconds: input.targetDurationSeconds,
    textPreset: input.textPreset,
    assets: input.assets,
    originalSourceText: input.originalSourceText,
    ...(input.headlineText === undefined ? {} : { headlineText: input.headlineText }),
    ...(input.subtitleTemplateId === undefined ? {} : { subtitleTemplateId: input.subtitleTemplateId }),
    ...(input.allowedDecorationIds === undefined ? {} : { allowedDecorationIds: input.allowedDecorationIds }),
  };
}

export class ProductionPlanningFlow {
  readonly #dependencies: ProductionPlanningFlowDependencies;

  constructor(dependencies: ProductionPlanningFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: ProductionPlanInput): Promise<ProductionPlanResultV3> {
    validateInput(input);
    const constraints = planConstraintsFromInput(input);
    const request = async (prompt: string) => this.#dependencies.provider.generate({
      model: "text",
      output: "json",
      jsonSchema: { name: "production_plan_v2", schema: productionPlanResultJsonSchema, strict: true },
      messages: [{ role: "system", content: prompt }],
      ...(this.#dependencies.onEvent ? { onEvent: this.#dependencies.onEvent } : {}),
    });
    const grounding = groundingOf(input);
    const initial = await request(productionPlanningPrompt(input));
    try {
      const result = withDerivedCues(parseStructuredOutput(initial.content, productionPlanResultV2Schema), input.subtitleTemplateId, grounding);
      validateProductionPlan(result, constraints);
      return result;
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
      const repaired = await request(productionPlanningRepairPrompt(initial.content, input));
      try {
        const result = withDerivedCues(parseStructuredOutput(repaired.content, productionPlanResultV2Schema), input.subtitleTemplateId, grounding);
        validateProductionPlan(result, constraints);
        return result;
      } catch (repairError) {
        throw new TaskError({ code: "AI_FORMAT_REPAIR_FAILED", message: "制作计划修复后仍不符合执行约束", action: "retry", cause: repairError });
      }
    }
  }
}
