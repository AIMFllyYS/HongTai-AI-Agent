import { createRuntimeId, TaskError } from "@hongtai/core";
import type { StructuredGenerationModuleId } from "@hongtai/core";
import type { AiGenerateResult, AiRequestMessage, AiStreamEvent } from "../../contracts/provider";
import type {
  AiMessage,
  DiagnosisFlowDependencies,
  DiagnosisImageInput,
  DiagnosisReportRunResult,
  DiagnosisSession,
} from "../../contracts/diagnosis";
import { diagnosisConversationPrompt } from "../../prompts/diagnosis-conversation";
import {
  DIAGNOSIS_FOLLOW_UP_QUESTIONS_PROMPT_VERSION,
  diagnosisFollowUpQuestionsPrompt,
  diagnosisFollowUpQuestionsRepairPrompt,
} from "../../prompts/diagnosis-follow-up-questions";
import {
  DIAGNOSIS_OBSERVATION_SUMMARY_PROMPT_VERSION,
  diagnosisObservationSummaryPrompt,
  diagnosisObservationSummaryRepairPrompt,
} from "../../prompts/diagnosis-observation-summary";
import {
  DIAGNOSIS_SAFETY_LIMITATIONS_PROMPT_VERSION,
  diagnosisSafetyLimitationsPrompt,
  diagnosisSafetyLimitationsRepairPrompt,
} from "../../prompts/diagnosis-safety-limitations";
import {
  DIAGNOSIS_VISUAL_OBSERVATIONS_PROMPT_VERSION,
  diagnosisVisualObservationsPrompt,
  diagnosisVisualObservationsRepairPrompt,
} from "../../prompts/diagnosis-visual-observations";
import {
  DIAGNOSIS_WELLNESS_RECOMMENDATIONS_PROMPT_VERSION,
  diagnosisWellnessRecommendationsPrompt,
  diagnosisWellnessRecommendationsRepairPrompt,
} from "../../prompts/diagnosis-wellness-recommendations";
import {
  diagnosisFollowUpQuestionsJsonSchema,
  diagnosisFollowUpQuestionsSchema,
  diagnosisObservationSummaryJsonSchema,
  diagnosisObservationSummarySchema,
  diagnosisReportSchema,
  diagnosisSafetyLimitationsJsonSchema,
  diagnosisSafetyLimitationsSchema,
  diagnosisVisualObservationsJsonSchema,
  diagnosisVisualObservationsSchema,
  diagnosisWellnessRecommendationsJsonSchema,
  diagnosisWellnessRecommendationsSchema,
  type DiagnosisReportV1,
  type ObservationMode,
} from "../../schemas/diagnosis-report";
import { generateStructuredModule, type StructuredModuleAttempt } from "../../structured-output/generate-structured-module";
import { StructuredGenerationProgressTracker } from "../../structured-output/structured-generation-progress";

const IMAGE_MIME_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]*$/;

function base64(data: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function messageId(): string {
  return createRuntimeId();
}

function normalizedImageMimeType(value: unknown): string {
  const mimeType = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!IMAGE_MIME_TYPE_PATTERN.test(mimeType) || mimeType === "image/svg+xml") {
    throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片类型无效", action: "select_media" });
  }
  return mimeType;
}

function safeSession(value: DiagnosisSession | undefined, expectedSessionId: string): DiagnosisSession {
  if (!value || value.id !== expectedSessionId || !value.reportId || !value.createdAt ||
      (value.mode !== "tongue" && value.mode !== "face")) {
    throw new TaskError({ code: "AI_SESSION_NOT_FOUND", message: "没有找到可生成报告的观察会话", action: "none" });
  }
  return {
    id: value.id,
    reportId: value.reportId,
    mode: value.mode,
    createdAt: value.createdAt,
    image: { mimeType: normalizedImageMimeType(value.image?.mimeType) },
  };
}

function safeSessionImage(value: DiagnosisImageInput | undefined, expectedMimeType: string): DiagnosisImageInput {
  if (!value) {
    throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片已不可用，请重新选择图片", action: "select_media" });
  }
  const mimeType = normalizedImageMimeType(value.mimeType);
  if (mimeType !== expectedMimeType) {
    throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片类型与已保存元数据不一致", action: "select_media" });
  }
  if ("data" in value) {
    if (!value.data || value.data.byteLength === 0) {
      throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片为空", action: "select_media" });
    }
    return { mimeType, data: value.data };
  }
  if (!value.uri.trim()) {
    throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片引用无效", action: "select_media" });
  }
  return { mimeType, uri: value.uri };
}

function imageMessage(image: DiagnosisImageInput) {
  if ("data" in image) {
    const data = image.data;
    if (!data) {
      throw new TaskError({ code: "IMAGE_INVALID", message: "会话图片为空", action: "select_media" });
    }
    return { type: "image_url" as const, imageUrl: `data:${image.mimeType};base64,${base64(data)}` };
  }
  return { type: "image_uri" as const, uri: image.uri, mimeType: image.mimeType };
}

function diagnosisVisualFailure(error: unknown): unknown {
  return error instanceof TaskError && error.code === "AI_PERMISSION_DENIED"
    ? new TaskError({ code: "AI_VISION_UNAVAILABLE", message: "当前AI连接没有可用的视觉模型能力", action: "configure_ai", cause: error })
    : error;
}

const REPORT_MODULE_IDS = [
  "visual-observations",
  "observation-summary",
  "wellness-recommendations",
  "safety-limitations",
  "follow-up-questions",
] as const satisfies readonly StructuredGenerationModuleId[];

const REPORT_PROMPT_VERSIONS = [
  DIAGNOSIS_VISUAL_OBSERVATIONS_PROMPT_VERSION,
  DIAGNOSIS_OBSERVATION_SUMMARY_PROMPT_VERSION,
  DIAGNOSIS_WELLNESS_RECOMMENDATIONS_PROMPT_VERSION,
  DIAGNOSIS_SAFETY_LIMITATIONS_PROMPT_VERSION,
  DIAGNOSIS_FOLLOW_UP_QUESTIONS_PROMPT_VERSION,
] as const;

function validateVisualMode(value: import("../../schemas/diagnosis-report").DiagnosisVisualObservations, mode: ObservationMode): void {
  const allowedPrefix = mode === "tongue" ? "tongue_" : "facial_";
  if (value.observations.some((item) => item.category !== "localized_feature" && !item.category.startsWith(allowedPrefix))) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "观察分类与用户选择的图片类型不匹配", action: "retry" });
  }
}

function validateWellnessReferences(
  value: import("../../schemas/diagnosis-report").DiagnosisWellnessRecommendations,
  visual: import("../../schemas/diagnosis-report").DiagnosisVisualObservations,
): void {
  const ids = new Set(visual.observations.map((item) => item.id));
  const references = [
    ...value.wellnessReferences.flatMap((item) => item.basisObservationIds),
    ...value.recommendations.flatMap((item) => item.relatedObservationIds),
  ];
  if (references.some((id) => !ids.has(id))) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "状态参考或建议引用了不存在的观察项", action: "retry" });
  }
  if (!visual.imageQuality.usable && (value.wellnessReferences.length > 0 || value.recommendations.length > 0)) {
    throw new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message: "图片不可用时不能生成无依据的状态参考或建议", action: "retry" });
  }
}

export class DiagnosisFlow {
  readonly #dependencies: DiagnosisFlowDependencies;

  constructor(dependencies: DiagnosisFlowDependencies) {
    this.#dependencies = dependencies;
  }

  /** Creates and persists a session, then runs the same formal report path used for resumed sessions. */
  async analyze(input: { readonly mode: ObservationMode; readonly image: DiagnosisImageInput }): Promise<DiagnosisReportRunResult> {
    const image = safeSessionImage(input.image, normalizedImageMimeType(input.image.mimeType));
    const session = await this.#dependencies.repository.createSession(input.mode, image);
    return this.runReport(session.id);
  }

  /**
   * Generates diagnosis-report.v1 for an already-created session. The private
   * image is loaded only inside the repository/flow boundary and never appears
   * on the returned session projection.
   */
  async runReport(sessionId: string): Promise<DiagnosisReportRunResult> {
    const storedSession = await this.#dependencies.repository.getSession(sessionId);
    if (!storedSession) {
      throw new TaskError({ code: "AI_SESSION_NOT_FOUND", message: "没有找到可生成报告的观察会话", action: "none" });
    }
    const runId = createRuntimeId();
    const startedAt = new Date().toISOString();
    const progress = new StructuredGenerationProgressTracker("diagnosis-report", REPORT_MODULE_IDS, this.#dependencies.onProgress);
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
      const session = safeSession(storedSession, sessionId);
      const image = safeSessionImage(
        await this.#dependencies.repository.loadSessionImage(session.id),
        session.image.mimeType,
      );
      await progress.preparing();

      await progress.running("visual-observations");
      let visual;
      try {
        visual = await generateStructuredModule({
          provider: this.#dependencies.provider,
          request: {
            model: "vision",
            output: "json",
            jsonSchema: {
              name: "diagnosis_visual_observations_v1",
              schema: diagnosisVisualObservationsJsonSchema,
              strict: true,
            },
            messages: [
              { role: "system", content: diagnosisVisualObservationsPrompt(session.mode) },
              { role: "user", content: [
                { type: "text", text: "请只生成可见观察模块。" },
                imageMessage(image),
              ] },
            ],
            onEvent,
          },
          schema: diagnosisVisualObservationsSchema,
          validate: (value) => validateVisualMode(value, session.mode),
          repairPrompt: (raw) => diagnosisVisualObservationsRepairPrompt(raw, session.mode),
          failureMessage: "可见观察模块修复后仍不符合Schema",
          ...lifecycle("visual-observations"),
        });
      } catch (error) {
        throw diagnosisVisualFailure(error);
      }
      await progress.succeeded("visual-observations", visual);

      await progress.running("observation-summary");
      const summary = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "text",
          output: "json",
          jsonSchema: {
            name: "diagnosis_observation_summary_v1",
            schema: diagnosisObservationSummaryJsonSchema,
            strict: true,
          },
          messages: [{ role: "system", content: diagnosisObservationSummaryPrompt(session.mode, visual) }],
          onEvent,
        },
        schema: diagnosisObservationSummarySchema,
        repairPrompt: diagnosisObservationSummaryRepairPrompt,
        failureMessage: "观察摘要模块修复后仍不符合Schema",
        ...lifecycle("observation-summary"),
      });
      await progress.succeeded("observation-summary", summary);

      await progress.running("wellness-recommendations");
      const wellness = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "text",
          output: "json",
          jsonSchema: {
            name: "diagnosis_wellness_recommendations_v1",
            schema: diagnosisWellnessRecommendationsJsonSchema,
            strict: true,
          },
          messages: [{ role: "system", content: diagnosisWellnessRecommendationsPrompt(visual, summary) }],
          onEvent,
        },
        schema: diagnosisWellnessRecommendationsSchema,
        validate: (value) => validateWellnessReferences(value, visual),
        repairPrompt: (raw) => diagnosisWellnessRecommendationsRepairPrompt(raw, visual.observations.map((item) => item.id)),
        failureMessage: "状态参考与建议模块修复后仍不符合Schema或引用约束",
        ...lifecycle("wellness-recommendations"),
      });
      await progress.succeeded("wellness-recommendations", wellness);

      await progress.running("safety-limitations");
      const safety = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "text",
          output: "json",
          jsonSchema: {
            name: "diagnosis_safety_limitations_v1",
            schema: diagnosisSafetyLimitationsJsonSchema,
            strict: true,
          },
          messages: [{ role: "system", content: diagnosisSafetyLimitationsPrompt({ ...visual, ...summary, ...wellness }) }],
          onEvent,
        },
        schema: diagnosisSafetyLimitationsSchema,
        repairPrompt: diagnosisSafetyLimitationsRepairPrompt,
        failureMessage: "安全与限制模块修复后仍不符合Schema",
        ...lifecycle("safety-limitations"),
      });
      await progress.succeeded("safety-limitations", safety);

      await progress.running("follow-up-questions");
      const followUp = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "text",
          output: "json",
          jsonSchema: {
            name: "diagnosis_follow_up_questions_v1",
            schema: diagnosisFollowUpQuestionsJsonSchema,
            strict: true,
          },
          messages: [{ role: "system", content: diagnosisFollowUpQuestionsPrompt({ ...visual, ...summary, ...wellness, ...safety }) }],
          onEvent,
        },
        schema: diagnosisFollowUpQuestionsSchema,
        repairPrompt: diagnosisFollowUpQuestionsRepairPrompt,
        failureMessage: "追问模块修复后仍不符合Schema",
        ...lifecycle("follow-up-questions"),
      });
      await progress.succeeded("follow-up-questions", followUp);

      const assembled: DiagnosisReportV1 = {
        schemaVersion: "diagnosis-report.v1",
        mode: session.mode,
        promptVersion: "diagnosis-modular.v1",
        ...visual,
        ...summary,
        ...wellness,
        ...safety,
        ...followUp,
      };
      const report = diagnosisReportSchema.safeParse(assembled);
      if (!report.success) {
        throw new TaskError({
          code: "AI_STRUCTURED_OUTPUT_INVALID",
          message: "观察报告模块组装后不符合最终Schema",
          action: "retry",
          cause: report.error,
        });
      }
      await progress.saving();
      await this.#dependencies.repository.saveReport(session.id, report.data);
      await this.#dependencies.repository.saveRun(session.id, {
        id: runId,
        kind: "diagnosis",
        status: "succeeded",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse,
        reasoning,
        promptVersions: REPORT_PROMPT_VERSIONS,
      });
      return { session, report: report.data };
    } catch (error) {
      await this.#dependencies.repository.saveRun(sessionId, {
        id: runId, kind: "diagnosis", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning,
        promptVersions: REPORT_PROMPT_VERSIONS,
        errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR",
      });
      throw error;
    }
  }

  async chat(sessionId: string, question: string): Promise<AiMessage> {
    const session = await this.#dependencies.repository.getSession(sessionId);
    const report = await this.#dependencies.repository.getReport(sessionId);
    if (!session || !report) throw new TaskError({ code: "AI_SESSION_NOT_FOUND", message: "没有找到可继续对话的观察会话", action: "none" });
    if (!question.trim()) throw new TaskError({ code: "INPUT_EMPTY", message: "对话内容不能为空", action: "edit_input" });
    const runId = createRuntimeId();
    const startedAt = new Date().toISOString();
    let reasoning = "";
    let rawResponse = "";
    try {
      const messages = await this.#conversationMessages(sessionId, report, question.trim());
      const result: AiGenerateResult = await this.#dependencies.provider.generate({
        model: "text",
        output: "text",
        messages,
        onEvent: async (event) => {
          if (event.type === "reasoning_delta") reasoning += `${reasoning ? "\n" : ""}${event.delta}`;
          await this.#dependencies.onEvent?.({ ...event, runId });
        },
      });
      rawResponse = result.content;
      const now = new Date().toISOString();
      const userMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "user", content: question.trim(), status: "completed", createdAt: now };
      const assistantMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "assistant", content: result.content, status: "completed", createdAt: new Date().toISOString() };
      await this.#dependencies.repository.appendMessages(sessionId, [userMessage, assistantMessage]);
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "succeeded", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning });
      return assistantMessage;
    } catch (error) {
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse, reasoning, errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR" });
      throw error;
    }
  }

  async #conversationMessages(sessionId: string, report: import("../../schemas/diagnosis-report").DiagnosisReportV1, question: string): Promise<AiRequestMessage[]> {
    const history = await this.#dependencies.repository.listMessages(sessionId);
    let summary = await this.#dependencies.repository.getContextSummary(sessionId);
    const base: AiRequestMessage[] = [
      { role: "system", content: diagnosisConversationPrompt(report) },
      ...(summary ? [{ role: "system" as const, content: `较早对话摘要：${summary}` }] : []),
      ...history.map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
      { role: "user", content: question },
    ];
    const estimatedTokens = Math.ceil(JSON.stringify(base).length / 2);
    if (estimatedTokens > this.#dependencies.contextWindowTokens * 0.8 && history.length > 6) {
      const older = history.slice(0, -6);
      let result: AiGenerateResult;
      try {
        result = await this.#dependencies.provider.generate({
          model: "text",
          output: "text",
          messages: [
            { role: "system", content: "将以下较早对话压缩为忠实、简短的中文事实摘要，不加入新建议。" },
            { role: "user", content: JSON.stringify(older) },
          ],
        });
      } catch (error) {
        throw new TaskError({ code: "AI_CONTEXT_SUMMARY_FAILED", message: "较早对话摘要生成失败", action: "retry", cause: error });
      }
      summary = result.content;
      await this.#dependencies.repository.saveContextSummary(sessionId, summary);
      return [
        { role: "system", content: diagnosisConversationPrompt(report) },
        { role: "system", content: `较早对话摘要：${summary}` },
        ...history.slice(-6).map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
        { role: "user", content: question },
      ];
    }
    return base;
  }
}
