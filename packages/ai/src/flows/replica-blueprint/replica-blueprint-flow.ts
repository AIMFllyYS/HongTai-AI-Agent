import { resolveTemplateForPrecision, TaskError } from "@hongtai/core";

import type { ReplicaBlueprintFlowDependencies, ReplicaBlueprintInput } from "../../contracts/replica-blueprint";
import { assertEvidenceRefs } from "../../evidence";
import { sharesVerbatimRun } from "../../originality";
import { replicaBlueprintPrompt, replicaBlueprintRepairPrompt } from "../../prompts/replica-blueprint";
import {
  REPLICA_BLUEPRINT_BOUNDS,
  replicaBlueprintResponseJsonSchema,
  replicaBlueprintResponseSchema,
  replicaBlueprintResultSchema,
  type ReplicaBlueprintResponse,
  type ReplicaBlueprintResultV1,
} from "../../schemas/replica-blueprint";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

/**
 * A blueprint is written before anything has been recorded, so there is no audio to time captions
 * against. Any template that needs word-level timing degrades here rather than promising the user a
 * per-word reveal the export cannot produce.
 */
const BLUEPRINT_TIMING_PRECISION = "estimated" as const;

function invalidBlueprint(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

function assertShotOrder(value: ReplicaBlueprintResponse): void {
  for (const [index, shot] of value.shots.entries()) {
    if (shot.order !== index + 1) throw invalidBlueprint("复刻蓝图分镜序号必须从1连续递增");
  }
}

/**
 * Empty and non-empty are both legitimate, but they mean opposite things and cannot be mixed: a
 * blank list without a reason reads as a bug, and a reason next to real shots hides which one the
 * user should trust.
 */
function assertEmptiness(value: ReplicaBlueprintResponse): void {
  if (value.shots.length === 0 && !value.emptyReason?.trim()) {
    throw invalidBlueprint("复刻蓝图给不出分镜时必须说明缺少哪些证据");
  }
  if (value.shots.length > 0 && value.emptyReason !== null) {
    throw invalidBlueprint("复刻蓝图已经给出分镜时不能同时声明证据不足");
  }
}

/**
 * A list whose total falls outside what any single project can run would have the user filming
 * material that cannot be used. This keeps the total inside the range; matching it to the exact
 * target duration the user picks is the production side's job.
 */
function assertTotalDuration(value: ReplicaBlueprintResponse): void {
  if (value.shots.length === 0) return;
  const total = value.shots.reduce((sum, shot) => sum + shot.material.suggestedDurationSeconds, 0);
  const { minTotalSeconds, maxTotalSeconds } = REPLICA_BLUEPRINT_BOUNDS;
  if (total < minTotalSeconds || total > maxTotalSeconds) {
    throw invalidBlueprint(`复刻蓝图建议时长合计${total}秒，超出可成片的${minTotalSeconds}到${maxTotalSeconds}秒`);
  }
}

function assertOriginalScript(value: ReplicaBlueprintResponse, input: ReplicaBlueprintInput): void {
  if (!input.originalSourceText) return;
  const drafts = value.shots.map((shot) => shot.scriptDraft).join("");
  if (sharesVerbatimRun(drafts, input.originalSourceText)) {
    throw invalidBlueprint("复刻蓝图脚本草稿与参考原文存在连续重复，请重新组织原创表达");
  }
}

function documentFrom(value: ReplicaBlueprintResponse, input: ReplicaBlueprintInput): ReplicaBlueprintResultV1 {
  assertShotOrder(value);
  assertEmptiness(value);
  assertTotalDuration(value);
  assertOriginalScript(value, input);
  assertEvidenceRefs({
    references: value.shots.flatMap((shot) => shot.evidenceRefs),
    units: input.evidenceUnits,
    message: "复刻蓝图引用了不存在的原文证据",
  });

  const resolved = resolveTemplateForPrecision({ requestedId: value.suggestedTemplateId, precision: BLUEPRINT_TIMING_PRECISION });
  const parsed = replicaBlueprintResultSchema.safeParse({
    schemaVersion: "replica-blueprint.v1",
    source: { analysisTaskId: input.analysis.source.taskId, analysisSchemaVersion: input.analysis.schemaVersion },
    premise: value.premise,
    subtitle: { templateId: resolved.template.id, degradedFromTemplateId: resolved.degradedFrom ?? null },
    shots: value.shots,
    emptyReason: value.emptyReason,
  });
  if (!parsed.success) throw invalidBlueprint("复刻蓝图组装后不符合最终Schema", parsed.error);
  return parsed.data;
}

export class ReplicaBlueprintFlow {
  readonly #dependencies: ReplicaBlueprintFlowDependencies;

  constructor(dependencies: ReplicaBlueprintFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: ReplicaBlueprintInput): Promise<ReplicaBlueprintResultV1> {
    // Without the units there is nothing to cite, and a blueprint whose citations cannot be checked
    // is the fabrication this document exists to prevent.
    if (input.evidenceUnits.length === 0) {
      throw new TaskError({
        code: "TASK_ARTIFACT_MISSING",
        message: "这条任务没有可供复刻的原文或转写证据",
        action: "view_partial_result",
      });
    }

    const request = async (prompt: string) => this.#dependencies.provider.generate({
      model: "text",
      output: "json",
      jsonSchema: { name: "replica_blueprint_v1", schema: replicaBlueprintResponseJsonSchema, strict: true },
      messages: [{ role: "system", content: prompt }],
    });

    const initial = await request(replicaBlueprintPrompt(input));
    try {
      return documentFrom(parseStructuredOutput(initial.content, replicaBlueprintResponseSchema), input);
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
      const repaired = await request(replicaBlueprintRepairPrompt(initial.content, input));
      try {
        return documentFrom(parseStructuredOutput(repaired.content, replicaBlueprintResponseSchema), input);
      } catch (repairError) {
        throw new TaskError({
          code: "AI_FORMAT_REPAIR_FAILED",
          message: "复刻蓝图格式修复失败",
          action: "retry",
          cause: repairError,
        });
      }
    }
  }
}
