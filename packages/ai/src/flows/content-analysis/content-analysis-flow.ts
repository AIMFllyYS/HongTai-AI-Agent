import { createRuntimeId, TaskError } from "@hongtai/core";
import type { ContentAnalysisFlowDependencies, ContentAnalysisInput, ContentAnalysisRunRecord } from "../../contracts/content-analysis";
import type { AiStreamEvent } from "../../contracts/provider";
import { contentAnalysisPrompt, contentAnalysisRepairPrompt } from "../../prompts/content-analysis";
import { contentAnalysisResultJsonSchema, contentAnalysisResultSchema, type ContentAnalysisResultV1 } from "../../schemas/content-analysis";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

function validateSemantics(result: ContentAnalysisResultV1, input: ContentAnalysisInput): void {
  if (result.source.taskId !== input.taskId || result.source.platform !== input.platform || result.source.contentType !== input.contentType || result.source.sourceKind !== input.sourceKind) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "内容拆解的来源字段与真实任务不一致", action: "retry" });
  }
  const validIds = new Set(input.evidenceUnits.map((item) => item.id));
  const references = [
    ...result.hook.evidenceRefs,
    ...result.painPoints.flatMap((item) => item.evidenceRefs),
    ...result.emotionalDrivers.flatMap((item) => item.evidenceRefs),
    ...result.structure.flatMap((item) => item.evidenceRefs),
    ...result.coreClaims.flatMap((item) => item.evidenceRefs),
    ...result.risks.flatMap((item) => item.evidenceRefs),
  ];
  if (references.some((id) => !validIds.has(id))) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "内容拆解引用了不存在的原文证据", action: "retry" });
  }
}

export class ContentAnalysisFlow {
  readonly #dependencies: ContentAnalysisFlowDependencies;

  constructor(dependencies: ContentAnalysisFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(taskId: string): Promise<ContentAnalysisResultV1> {
    const input = await this.#dependencies.store.loadInput(taskId);
    if (input.evidenceUnits.length === 0) throw new TaskError({ code: "TASK_ARTIFACT_MISSING", message: "任务没有可供拆解的正文或转写证据", action: "view_partial_result" });
    const runId = createRuntimeId();
    const startedAt = new Date().toISOString();
    let reasoning = "";
    let rawResponse = "";
    const onEvent = async (event: AiStreamEvent) => {
      if (event.type === "reasoning_delta") reasoning += `${reasoning ? "\n" : ""}${event.delta}`;
      await this.#dependencies.onEvent?.({ ...event, runId });
    };
    try {
      const initial = await this.#dependencies.provider.generate({
        model: "text", output: "json", jsonSchema: { name: "content_analysis_v1", schema: contentAnalysisResultJsonSchema, strict: true }, messages: [{ role: "system", content: contentAnalysisPrompt(input) }], onEvent,
      });
      rawResponse = initial.content;
      let result: ContentAnalysisResultV1;
      try {
        result = parseStructuredOutput(initial.content, contentAnalysisResultSchema);
        validateSemantics(result, input);
      } catch (error) {
        if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
        const repaired = await this.#dependencies.provider.generate({
          model: "text", output: "json", jsonSchema: { name: "content_analysis_v1", schema: contentAnalysisResultJsonSchema, strict: true }, messages: [{ role: "system", content: contentAnalysisRepairPrompt(initial.content, input) }], onEvent,
        });
        rawResponse = `${initial.content}\n\n--- repaired ---\n${repaired.content}`;
        try {
          result = parseStructuredOutput(repaired.content, contentAnalysisResultSchema);
          validateSemantics(result, input);
        } catch (repairError) {
          throw new TaskError({ code: "AI_FORMAT_REPAIR_FAILED", message: "内容拆解修复后仍不符合Schema或证据约束", action: "retry", cause: repairError });
        }
      }
      const run: ContentAnalysisRunRecord = { id: runId, status: "succeeded", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning };
      await this.#dependencies.store.saveResult(taskId, result, run);
      return result;
    } catch (error) {
      const run: ContentAnalysisRunRecord = { id: runId, status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning, errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR" };
      await this.#dependencies.store.saveFailedRun(taskId, run).catch(() => undefined);
      throw error;
    }
  }
}
