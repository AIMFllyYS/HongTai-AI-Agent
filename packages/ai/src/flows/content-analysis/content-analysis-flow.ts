import { createRuntimeId, TaskError } from "@hongtai/core";
import type { StructuredGenerationModuleId } from "@hongtai/core";

import type {
  ContentAnalysisFlowDependencies,
  ContentAnalysisInput,
  ContentAnalysisRunRecord,
} from "../../contracts/content-analysis";
import type { AiGenerateRequest, AiStreamEvent } from "../../contracts/provider";
import {
  CONTENT_ANALYSIS_HOOK_DRIVERS_PROMPT_VERSION,
  contentAnalysisHookDriversPrompt,
  contentAnalysisHookDriversRepairPrompt,
} from "../../prompts/content-analysis-hook-drivers";
import {
  CONTENT_ANALYSIS_OVERVIEW_PROMPT_VERSION,
  contentAnalysisOverviewPrompt,
  contentAnalysisOverviewRepairPrompt,
} from "../../prompts/content-analysis-overview";
import {
  CONTENT_ANALYSIS_RISKS_BOUNDARIES_PROMPT_VERSION,
  contentAnalysisRisksBoundariesPrompt,
  contentAnalysisRisksBoundariesRepairPrompt,
} from "../../prompts/content-analysis-risks-boundaries";
import {
  CONTENT_ANALYSIS_STRUCTURE_CLAIMS_PROMPT_VERSION,
  contentAnalysisStructureClaimsPrompt,
  contentAnalysisStructureClaimsRepairPrompt,
} from "../../prompts/content-analysis-structure-claims";
import {
  CONTENT_ANALYSIS_STYLE_TEMPLATE_PROMPT_VERSION,
  contentAnalysisStyleTemplatePrompt,
  contentAnalysisStyleTemplateRepairPrompt,
} from "../../prompts/content-analysis-style-template";
import {
  contentAnalysisHookDriversJsonSchema,
  contentAnalysisHookDriversSchema,
  contentAnalysisOverviewJsonSchema,
  contentAnalysisOverviewSchema,
  contentAnalysisResultSchema,
  contentAnalysisRisksBoundariesJsonSchema,
  contentAnalysisRisksBoundariesSchema,
  contentAnalysisStructureClaimsJsonSchema,
  contentAnalysisStructureClaimsSchema,
  contentAnalysisStyleTemplateJsonSchema,
  contentAnalysisStyleTemplateSchema,
  type ContentAnalysisResultV1,
} from "../../schemas/content-analysis";
import { generateStructuredModule, type StructuredModuleAttempt } from "../../structured-output/generate-structured-module";
import { StructuredGenerationProgressTracker } from "../../structured-output/structured-generation-progress";

const MODULE_IDS = [
  "overview",
  "hook-drivers",
  "structure-claims",
  "style-template",
  "risks-boundaries",
] as const satisfies readonly StructuredGenerationModuleId[];

const PROMPT_VERSIONS = [
  CONTENT_ANALYSIS_OVERVIEW_PROMPT_VERSION,
  CONTENT_ANALYSIS_HOOK_DRIVERS_PROMPT_VERSION,
  CONTENT_ANALYSIS_STRUCTURE_CLAIMS_PROMPT_VERSION,
  CONTENT_ANALYSIS_STYLE_TEMPLATE_PROMPT_VERSION,
  CONTENT_ANALYSIS_RISKS_BOUNDARIES_PROMPT_VERSION,
] as const;

function sourceFromInput(input: ContentAnalysisInput): ContentAnalysisResultV1["source"] {
  return {
    taskId: input.taskId,
    platform: input.platform,
    contentType: input.contentType,
    sourceKind: input.sourceKind,
  };
}

function validateEvidenceRefs(references: readonly string[], input: ContentAnalysisInput): void {
  const validIds = new Set(input.evidenceUnits.map((item) => item.id));
  if (references.some((id) => !validIds.has(id))) {
    throw new TaskError({
      code: "AI_STRUCTURED_OUTPUT_INVALID",
      message: "内容拆解引用了不存在的原文证据",
      action: "retry",
    });
  }
}

function request(
  name: string,
  schema: Readonly<Record<string, unknown>>,
  prompt: string,
  onEvent: (event: AiStreamEvent) => Promise<void>,
): AiGenerateRequest {
  return {
    model: "text",
    output: "json",
    jsonSchema: { name, schema, strict: true },
    messages: [{ role: "system", content: prompt }],
    onEvent,
  };
}

export class ContentAnalysisFlow {
  readonly #dependencies: ContentAnalysisFlowDependencies;

  constructor(dependencies: ContentAnalysisFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(taskId: string): Promise<ContentAnalysisResultV1> {
    const input = await this.#dependencies.store.loadInput(taskId);
    if (input.evidenceUnits.length === 0) {
      throw new TaskError({
        code: "TASK_ARTIFACT_MISSING",
        message: "任务没有可供拆解的正文或转写证据",
        action: "view_partial_result",
      });
    }
    const runId = createRuntimeId();
    const startedAt = new Date().toISOString();
    const progress = new StructuredGenerationProgressTracker("content-analysis", MODULE_IDS, this.#dependencies.onProgress);
    let reasoning = "";
    let rawResponse = "";
    const onEvent = async (event: AiStreamEvent) => {
      if (event.type === "reasoning_delta") reasoning += `${reasoning ? "\n" : ""}${event.delta}`;
      await this.#dependencies.onEvent?.({ ...event, runId });
    };
    const capture = (moduleId: StructuredGenerationModuleId) => async (attempt: StructuredModuleAttempt) => {
      rawResponse += `${rawResponse ? "\n\n" : ""}--- ${moduleId}${attempt.repaired ? " repaired" : ""} ---\n${attempt.result.content}`;
    };
    const lifecycle = (moduleId: StructuredGenerationModuleId) => ({
      onRepairing: () => progress.repairing(moduleId),
      onValidating: (repairing: boolean) => progress.validating(moduleId, repairing),
      onFailed: () => progress.failed(moduleId),
      onAttempt: capture(moduleId),
    });

    try {
      await progress.preparing();

      await progress.running("overview");
      const overview = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: request(
          "content_analysis_overview_v1",
          contentAnalysisOverviewJsonSchema,
          contentAnalysisOverviewPrompt(input),
          onEvent,
        ),
        schema: contentAnalysisOverviewSchema,
        repairPrompt: (raw) => contentAnalysisOverviewRepairPrompt(raw, input),
        failureMessage: "内容概览修复后仍不符合Schema",
        ...lifecycle("overview"),
      });
      await progress.succeeded("overview", overview);

      await progress.running("hook-drivers");
      const hookDrivers = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: request(
          "content_analysis_hook_drivers_v1",
          contentAnalysisHookDriversJsonSchema,
          contentAnalysisHookDriversPrompt(input, overview),
          onEvent,
        ),
        schema: contentAnalysisHookDriversSchema,
        validate: (value) => validateEvidenceRefs([
          ...value.hook.evidenceRefs,
          ...value.painPoints.flatMap((item) => item.evidenceRefs),
          ...value.emotionalDrivers.flatMap((item) => item.evidenceRefs),
        ], input),
        repairPrompt: (raw) => contentAnalysisHookDriversRepairPrompt(raw, input),
        failureMessage: "内容钩子与驱动修复后仍不符合Schema或证据约束",
        ...lifecycle("hook-drivers"),
      });
      await progress.succeeded("hook-drivers", hookDrivers);

      await progress.running("structure-claims");
      const structureClaims = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: request(
          "content_analysis_structure_claims_v1",
          contentAnalysisStructureClaimsJsonSchema,
          contentAnalysisStructureClaimsPrompt(input, overview, hookDrivers),
          onEvent,
        ),
        schema: contentAnalysisStructureClaimsSchema,
        validate: (value) => validateEvidenceRefs([
          ...value.structure.flatMap((item) => item.evidenceRefs),
          ...value.coreClaims.flatMap((item) => item.evidenceRefs),
        ], input),
        repairPrompt: (raw) => contentAnalysisStructureClaimsRepairPrompt(raw, input),
        failureMessage: "内容结构与观点修复后仍不符合Schema或证据约束",
        ...lifecycle("structure-claims"),
      });
      await progress.succeeded("structure-claims", structureClaims);

      await progress.running("style-template");
      const styleTemplate = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: request(
          "content_analysis_style_template_v1",
          contentAnalysisStyleTemplateJsonSchema,
          contentAnalysisStyleTemplatePrompt(input, { ...overview, ...hookDrivers, ...structureClaims }),
          onEvent,
        ),
        schema: contentAnalysisStyleTemplateSchema,
        repairPrompt: (raw) => contentAnalysisStyleTemplateRepairPrompt(raw, input),
        failureMessage: "内容风格与模板修复后仍不符合Schema",
        ...lifecycle("style-template"),
      });
      await progress.succeeded("style-template", styleTemplate);

      await progress.running("risks-boundaries");
      const risksBoundaries = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: request(
          "content_analysis_risks_boundaries_v1",
          contentAnalysisRisksBoundariesJsonSchema,
          contentAnalysisRisksBoundariesPrompt(input, {
            ...overview,
            ...hookDrivers,
            ...structureClaims,
            ...styleTemplate,
          }),
          onEvent,
        ),
        schema: contentAnalysisRisksBoundariesSchema,
        validate: (value) => validateEvidenceRefs(value.risks.flatMap((item) => item.evidenceRefs), input),
        repairPrompt: (raw) => contentAnalysisRisksBoundariesRepairPrompt(raw, input),
        failureMessage: "内容风险与边界修复后仍不符合Schema或证据约束",
        ...lifecycle("risks-boundaries"),
      });
      await progress.succeeded("risks-boundaries", risksBoundaries);

      const assembled: ContentAnalysisResultV1 = {
        schemaVersion: "content-analysis.v1",
        source: sourceFromInput(input),
        ...overview,
        ...hookDrivers,
        ...structureClaims,
        ...styleTemplate,
        ...risksBoundaries,
      };
      const final = contentAnalysisResultSchema.safeParse(assembled);
      if (!final.success) {
        throw new TaskError({
          code: "AI_STRUCTURED_OUTPUT_INVALID",
          message: "内容拆解模块组装后不符合最终Schema",
          action: "retry",
          cause: final.error,
        });
      }
      await progress.saving();
      const run: ContentAnalysisRunRecord = {
        id: runId,
        status: "succeeded",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse,
        reasoning,
        promptVersions: PROMPT_VERSIONS,
      };
      await this.#dependencies.store.saveResult(taskId, final.data, run);
      return final.data;
    } catch (error) {
      const run: ContentAnalysisRunRecord = {
        id: runId,
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse,
        reasoning,
        promptVersions: PROMPT_VERSIONS,
        errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR",
      };
      await this.#dependencies.store.saveFailedRun(taskId, run).catch(() => undefined);
      throw error;
    }
  }
}
