import { createRuntimeId, TaskError } from "@hongtai/core";
import type { ErrorCode, StructuredGenerationModuleId } from "@hongtai/core";

import type {
  ContentAnalysisFlowDependencies,
  ContentAnalysisInput,
  ContentAnalysisRunRecord,
} from "../../contracts/content-analysis";
import type { AiStreamEvent } from "../../contracts/provider";
import { assertEvidenceRefs } from "../../evidence";
import {
  CONTENT_ANALYSIS_SINGLE_PROMPT_VERSION,
  contentAnalysisSinglePrompt,
  contentAnalysisSingleRepairPrompt,
} from "../../prompts/content-analysis-single";
import {
  contentAnalysisHookDriversSchema,
  contentAnalysisOverviewSchema,
  contentAnalysisResultSchema,
  contentAnalysisRisksBoundariesSchema,
  contentAnalysisSingleResponseFieldSchemas,
  contentAnalysisSingleResponseJsonSchema,
  contentAnalysisSingleResponseSchema,
  contentAnalysisStructureClaimsSchema,
  contentAnalysisStyleTemplateSchema,
  type ContentAnalysisHookDrivers,
  type ContentAnalysisResultV1,
  type ContentAnalysisRisksBoundaries,
  type ContentAnalysisSingleResponse,
  type ContentAnalysisStructureClaims,
} from "../../schemas/content-analysis";
import { generateStructuredModule } from "../../structured-output/generate-structured-module";
import {
  StructuredGenerationProgressTracker,
  type StructuredGenerationListenerIssue,
} from "../../structured-output/structured-generation-progress";
import { TopLevelJsonFieldStream, type CompletedTopLevelJsonField } from "../../structured-output/top-level-json-field-stream";

export interface FailedRunWriteIssue {
  readonly source: "saveFailedRun";
  readonly name: string;
  readonly code?: ErrorCode;
}

function projectFailedRunWriteIssue(error: unknown): FailedRunWriteIssue {
  return {
    source: "saveFailedRun",
    name: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof TaskError ? { code: error.code } : {}),
  };
}

const MODULE_IDS = [
  "overview",
  "hook-drivers",
  "structure-claims",
  "style-template",
  "risks-boundaries",
] as const satisfies readonly StructuredGenerationModuleId[];

const RESPONSE_KEYS = ["overview", "hookDrivers", "structureClaims", "styleTemplate", "risksBoundaries"] as const;
const PROMPT_VERSIONS = [CONTENT_ANALYSIS_SINGLE_PROMPT_VERSION] as const;

function sourceFromInput(input: ContentAnalysisInput): ContentAnalysisResultV1["source"] {
  return {
    taskId: input.taskId,
    platform: input.platform,
    contentType: input.contentType,
    sourceKind: input.sourceKind,
  };
}

function structuredIssue(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", ...(cause === undefined ? {} : { cause }) });
}

function validateEvidenceRefs(references: readonly string[], input: ContentAnalysisInput): void {
  assertEvidenceRefs({ references, units: input.evidenceUnits, message: "内容拆解引用了不存在的原文证据" });
}

function validateModuleEvidence(
  moduleId: StructuredGenerationModuleId,
  value: object,
  input: ContentAnalysisInput,
): void {
  if (moduleId === "hook-drivers") {
    const module = value as ContentAnalysisHookDrivers;
    validateEvidenceRefs([
      ...module.hook.evidenceRefs,
      ...module.painPoints.flatMap((item) => item.evidenceRefs),
      ...module.emotionalDrivers.flatMap((item) => item.evidenceRefs),
    ], input);
  }
  if (moduleId === "structure-claims") {
    const module = value as ContentAnalysisStructureClaims;
    validateEvidenceRefs([
      ...module.structure.flatMap((item) => item.evidenceRefs),
      ...module.coreClaims.flatMap((item) => item.evidenceRefs),
    ], input);
  }
  if (moduleId === "risks-boundaries") {
    const module = value as ContentAnalysisRisksBoundaries;
    validateEvidenceRefs(module.risks.flatMap((item) => item.evidenceRefs), input);
  }
}

function validatedResult(value: ContentAnalysisSingleResponse, input: ContentAnalysisInput): ContentAnalysisResultV1 {
  validateModuleEvidence("hook-drivers", value.hookDrivers, input);
  validateModuleEvidence("structure-claims", value.structureClaims, input);
  validateModuleEvidence("risks-boundaries", value.risksBoundaries, input);
  const result = contentAnalysisResultSchema.safeParse({
    schemaVersion: "content-analysis.v1",
    source: sourceFromInput(input),
    overview: value.overview,
    ...value.hookDrivers,
    ...value.structureClaims,
    ...value.styleTemplate,
    ...value.risksBoundaries,
  });
  if (!result.success) throw structuredIssue("内容拆解组装后不符合最终Schema", result.error);
  return result.data;
}

export class ContentAnalysisFlow {
  readonly #dependencies: ContentAnalysisFlowDependencies;
  #listenerIssues: readonly StructuredGenerationListenerIssue[] = [];
  #failedRunWriteIssues: readonly FailedRunWriteIssue[] = [];

  constructor(dependencies: ContentAnalysisFlowDependencies) {
    this.#dependencies = dependencies;
  }

  get listenerIssues(): readonly StructuredGenerationListenerIssue[] {
    return this.#listenerIssues;
  }

  get failedRunWriteIssues(): readonly FailedRunWriteIssue[] {
    return this.#failedRunWriteIssues;
  }

  async run(taskId: string): Promise<ContentAnalysisResultV1> {
    this.#listenerIssues = [];
    this.#failedRunWriteIssues = [];
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

    try {
      let parser = new TopLevelJsonFieldStream(RESPONSE_KEYS);
      let fields: Partial<ContentAnalysisSingleResponse> = {};
      let nextModuleIndex = 0;
      let repairingAttempt = false;
      let contentStarted = false;
      let streamIssue: TaskError | undefined;
      let failedModuleId: StructuredGenerationModuleId | undefined;
      let finalResult: ContentAnalysisResultV1 | undefined;

      const acceptField = (field: CompletedTopLevelJsonField): void => {
        const schema = contentAnalysisSingleResponseFieldSchemas[field.key as keyof typeof contentAnalysisSingleResponseFieldSchemas];
        if (!schema) return;
        const parsed = schema.safeParse(field.value);
        if (!parsed.success) throw structuredIssue(`内容拆解字段${field.key}不符合Schema`, parsed.error);
        switch (field.key) {
          case "overview": fields.overview = parsed.data as ContentAnalysisSingleResponse["overview"]; break;
          case "hookDrivers": fields.hookDrivers = parsed.data as ContentAnalysisSingleResponse["hookDrivers"]; break;
          case "structureClaims": fields.structureClaims = parsed.data as ContentAnalysisSingleResponse["structureClaims"]; break;
          case "styleTemplate": fields.styleTemplate = parsed.data as ContentAnalysisSingleResponse["styleTemplate"]; break;
          case "risksBoundaries": fields.risksBoundaries = parsed.data as ContentAnalysisSingleResponse["risksBoundaries"]; break;
        }
      };
      const moduleResult = (index: number): object | undefined => {
        const candidate = [
          fields.overview === undefined ? undefined : { overview: fields.overview },
          fields.hookDrivers,
          fields.structureClaims,
          fields.styleTemplate,
          fields.risksBoundaries,
        ][index];
        if (!candidate) return undefined;
        const schema = [
          contentAnalysisOverviewSchema,
          contentAnalysisHookDriversSchema,
          contentAnalysisStructureClaimsSchema,
          contentAnalysisStyleTemplateSchema,
          contentAnalysisRisksBoundariesSchema,
        ][index];
        const parsed = schema?.safeParse(candidate);
        if (!parsed?.success) throw structuredIssue("内容拆解板块不符合安全展示Schema", parsed?.error);
        const value = parsed.data as object;
        validateModuleEvidence(MODULE_IDS[index]!, value, input);
        return value;
      };
      const publishReadyModules = async (): Promise<void> => {
        while (nextModuleIndex < MODULE_IDS.length) {
          let result: object | undefined;
          try {
            result = moduleResult(nextModuleIndex);
          } catch (error) {
            streamIssue = error instanceof TaskError ? error : structuredIssue("内容拆解板块流式校验失败", error);
            failedModuleId = MODULE_IDS[nextModuleIndex];
            return;
          }
          if (!result) return;
          await progress.succeeded(MODULE_IDS[nextModuleIndex]!, result);
          nextModuleIndex += 1;
          const nextModuleId = MODULE_IDS[nextModuleIndex];
          if (nextModuleId) {
            await (repairingAttempt ? progress.repairing(nextModuleId) : progress.running(nextModuleId));
          }
        }
      };
      const acceptFields = async (completed: readonly CompletedTopLevelJsonField[]): Promise<void> => {
        if (streamIssue) return;
        try {
          for (const field of completed) {
            acceptField(field);
            await publishReadyModules();
          }
        } catch (error) {
          streamIssue = error instanceof TaskError ? error : structuredIssue("内容拆解流式JSON解析失败", error);
          failedModuleId ??= MODULE_IDS[Math.min(nextModuleIndex, MODULE_IDS.length - 1)];
        }
      };
      const onEvent = async (event: AiStreamEvent): Promise<void> => {
        if (event.type === "reasoning_delta") await progress.thinkingDelta(event.delta);
        if (event.type === "content_delta") {
          if (!contentStarted) {
            contentStarted = true;
            await progress.completeThinking();
          }
          if (!streamIssue) {
            try {
              await acceptFields(parser.push(event.delta));
            } catch (error) {
              streamIssue = error instanceof TaskError ? error : structuredIssue("内容拆解流式JSON解析失败", error);
              failedModuleId ??= MODULE_IDS[Math.min(nextModuleIndex, MODULE_IDS.length - 1)];
            }
          }
        }
        if (event.type === "completed") {
          await progress.completeThinking();
          if (!streamIssue) {
            try {
              await acceptFields(parser.finish());
            } catch (error) {
              streamIssue = error instanceof TaskError ? error : structuredIssue("内容拆解流式JSON未完整闭合", error);
              failedModuleId ??= MODULE_IDS[Math.min(nextModuleIndex, MODULE_IDS.length - 1)];
            }
          }
        }
        await this.#dependencies.onEvent?.({ ...event, runId });
      };

      await progress.preparing();
      await progress.running(MODULE_IDS[0]);
      const compact = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "text",
          output: "json",
          jsonSchema: {
            name: "content_analysis_single_response_v1",
            schema: contentAnalysisSingleResponseJsonSchema,
            strict: true,
          },
          maxOutputTokens: 4_096,
          messages: [{ role: "system", content: contentAnalysisSinglePrompt(input) }],
          onEvent,
        },
        schema: contentAnalysisSingleResponseSchema,
        validate: (value) => {
          if (streamIssue) throw streamIssue;
          finalResult = validatedResult(value, input);
        },
        repairPrompt: (raw) => contentAnalysisSingleRepairPrompt(raw, input),
        failureMessage: "内容拆解修复后仍不符合单对象Schema或证据约束",
        onRepairing: async () => {
          repairingAttempt = true;
          contentStarted = false;
          parser = new TopLevelJsonFieldStream(RESPONSE_KEYS);
          fields = {};
          nextModuleIndex = 0;
          streamIssue = undefined;
          failedModuleId = undefined;
          await progress.restartRepairing(MODULE_IDS[0]);
        },
        onValidating: async () => {
          await progress.completeThinking();
          await progress.validatingDocument();
        },
        onFailed: async () => {
          await progress.completeThinking();
          await progress.failed(failedModuleId ?? MODULE_IDS[Math.min(nextModuleIndex, MODULE_IDS.length - 1)]!);
        },
      });
      fields = compact;
      await publishReadyModules();
      finalResult ??= validatedResult(compact, input);
      await progress.saving();
      const run: ContentAnalysisRunRecord = {
        id: runId,
        status: "succeeded",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse: "",
        reasoning: "",
        promptVersions: PROMPT_VERSIONS,
      };
      await this.#dependencies.store.saveResult(taskId, finalResult, run);
      return finalResult;
    } catch (error) {
      const run: ContentAnalysisRunRecord = {
        id: runId,
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse: "",
        reasoning: "",
        promptVersions: PROMPT_VERSIONS,
        errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR",
      };
      try {
        await this.#dependencies.store.saveFailedRun(taskId, run);
      } catch (writeError) {
        this.#failedRunWriteIssues = [projectFailedRunWriteIssue(writeError)];
      }
      throw error;
    } finally {
      this.#listenerIssues = progress.listenerIssues;
    }
  }
}
