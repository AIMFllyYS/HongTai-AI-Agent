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
  DIAGNOSIS_SINGLE_PROMPT_VERSION,
  diagnosisSinglePrompt,
  diagnosisSingleRepairPrompt,
} from "../../prompts/diagnosis-report-single";
import { diagnosisContextSummarySchema } from "../../schemas/diagnosis-context-summary";
import {
  DIAGNOSIS_FOLLOW_UP_MAX_OUTPUT_TOKENS,
  diagnosisFollowUpReplySchema,
} from "../../schemas/diagnosis-follow-up";
import { estimateWeightedTokens } from "./estimate-context-tokens";
import {
  diagnosisFollowUpQuestionsSchema,
  diagnosisObservationSummarySchema,
  diagnosisReportSchema,
  diagnosisSafetyLimitationsSchema,
  diagnosisSingleResponseFieldSchemas,
  diagnosisSingleResponseJsonSchema,
  diagnosisSingleResponseSchema,
  diagnosisVisualObservationsSchema,
  diagnosisWellnessRecommendationsSchema,
  type DiagnosisFollowUpQuestions,
  type DiagnosisObservationSummary,
  type DiagnosisReportV1,
  type DiagnosisSafetyLimitations,
  type DiagnosisSingleResponse,
  type DiagnosisVisualObservations,
  type DiagnosisWellnessRecommendations,
  type ObservationMode,
} from "../../schemas/diagnosis-report";
import { generateStructuredModule } from "../../structured-output/generate-structured-module";
import { StructuredGenerationProgressTracker } from "../../structured-output/structured-generation-progress";
import { TopLevelJsonFieldStream, type CompletedTopLevelJsonField } from "../../structured-output/top-level-json-field-stream";

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

function parsedContextSummary(value: string, required: boolean): string {
  const parsed = diagnosisContextSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!required && !value.trim()) return "";
  throw new TaskError({ code: "AI_CONTEXT_SUMMARY_FAILED", message: "较早对话摘要未通过校验", action: "retry" });
}

const REPORT_MODULE_IDS = [
  "visual-observations",
  "observation-summary",
  "wellness-recommendations",
  "safety-limitations",
  "follow-up-questions",
] as const satisfies readonly StructuredGenerationModuleId[];

const REPORT_PROMPT_VERSIONS = [DIAGNOSIS_SINGLE_PROMPT_VERSION] as const;
const SINGLE_RESPONSE_KEYS = ["quality", "qualityNote", "observations", "summary", "wellnessReferences", "advice", "safety", "followUp"] as const;
const FIXED_DISCLAIMER = "本报告仅提供图片中可见状态的日常观察参考，不是疾病诊断，不提供患病概率，也不能替代专业检查。";

interface DiagnosisSections {
  readonly visual: DiagnosisVisualObservations;
  readonly summary: DiagnosisObservationSummary;
  readonly wellness: DiagnosisWellnessRecommendations;
  readonly safety: DiagnosisSafetyLimitations;
  readonly followUp: DiagnosisFollowUpQuestions;
}

function diagnosisSections(value: DiagnosisSingleResponse, mode: ObservationMode): DiagnosisSections {
  const usable = value.quality !== "unusable";
  const qualityNote = value.qualityNote.trim();
  const advice = value.advice.trim();
  const observations = usable ? value.observations : [];
  const observationIds = observations.map((_, index) => `obs-${index + 1}`);
  const visual: DiagnosisVisualObservations = {
    imageQuality: {
      usable,
      overallQuality: value.quality,
      limitations: value.quality === "good" ? [] : [qualityNote],
      retakeSuggestions: value.quality === "good" ? [] : ["请在自然光、对焦清晰且无遮挡的条件下重新拍摄。"],
    },
    observations: observations.map((item, index) => ({
      id: observationIds[index]!,
      category: item.category,
      region: item.region,
      label: item.label,
      description: item.description,
      visibility: value.quality === "good" ? "clear" : "limited",
      evidenceDescription: item.description,
    })),
  };
  const fallbackSummary = usable ? "本次图片未形成更多可确认的可见信息。" : "当前图片质量不足，暂不形成可见状态结论。";
  const summary: DiagnosisObservationSummary = {
    summary: {
      headline: usable ? `${mode === "tongue" ? "舌部" : "面部"}可见状态摘要` : "图片暂不适合观察",
      keyPoints: observations.length > 0
        ? observations.slice(0, 5).map((item) => item.description)
        : [value.summary || fallbackSummary],
      narrative: value.summary || fallbackSummary,
    },
  };
  const wellness: DiagnosisWellnessRecommendations = {
    wellnessReferences: observations.length > 0 ? value.wellnessReferences.map((item) => ({
      title: item.title,
      basisObservationIds: observationIds,
      statement: `${item.statement.replace(/[。；;\s]+$/u, "")}；单张图片不能据此诊断。`,
      certainty: "uncertain",
      notADiagnosis: true,
    })) : [],
    recommendations: observations.length > 0 && advice ? [{
      category: "monitoring",
      priority: "low",
      title: "日常记录建议",
      action: advice,
      rationale: "基于本次图片中已确认的可见状态，建议只用于日常记录和变化比较。",
      relatedObservationIds: observationIds,
    }] : [],
  };
  const safety: DiagnosisSafetyLimitations = {
    safetyGuidance: {
      level: usable ? "none" : "routine_attention",
      reasons: usable ? [] : [qualityNote || "当前图片不足以支持可见状态观察。"],
      recommendedAction: value.safety,
    },
    limitations: [
      "单张图片与拍摄条件会限制可见信息，不能替代专业检查。",
      ...(value.quality === "good" ? [] : ["建议在更合适的拍摄条件下重新记录。"]),
    ],
    disclaimer: FIXED_DISCLAIMER,
  };
  const followUp: DiagnosisFollowUpQuestions = {
    followUpQuestions: value.followUp ? [value.followUp] : [],
  };
  return { visual, summary, wellness, safety, followUp };
}

function structuredIssue(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", ...(cause === undefined ? {} : { cause }) });
}

function validatedReport(value: DiagnosisSingleResponse, mode: ObservationMode): DiagnosisReportV1 {
  const sections = diagnosisSections(value, mode);
  const result = diagnosisReportSchema.safeParse({
    schemaVersion: "diagnosis-report.v1",
    mode,
    promptVersion: DIAGNOSIS_SINGLE_PROMPT_VERSION,
    ...sections.visual,
    ...sections.summary,
    ...sections.wellness,
    ...sections.safety,
    ...sections.followUp,
  });
  if (!result.success) throw structuredIssue("观察报告组装后不符合最终Schema", result.error);
  return result.data;
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
    try {
      const session = safeSession(storedSession, sessionId);
      const image = safeSessionImage(
        await this.#dependencies.repository.loadSessionImage(session.id),
        session.image.mimeType,
      );
      let parser = new TopLevelJsonFieldStream(SINGLE_RESPONSE_KEYS);
      let fields: Partial<DiagnosisSingleResponse> = {};
      let nextModuleIndex = 0;
      let repairingAttempt = false;
      let contentStarted = false;
      let streamIssue: TaskError | undefined;
      let failedModuleId: StructuredGenerationModuleId | undefined;
      let reportResult: DiagnosisReportV1 | undefined;

      const acceptField = (field: CompletedTopLevelJsonField): void => {
        const schema = diagnosisSingleResponseFieldSchemas[field.key as keyof typeof diagnosisSingleResponseFieldSchemas];
        if (!schema) return;
        const parsed = schema.safeParse(field.value);
        if (!parsed.success) throw structuredIssue(`诊察字段${field.key}不符合Schema`, parsed.error);
        switch (field.key) {
          case "quality": fields.quality = parsed.data as DiagnosisSingleResponse["quality"]; break;
          case "qualityNote": fields.qualityNote = parsed.data as string; break;
          case "observations": fields.observations = parsed.data as DiagnosisSingleResponse["observations"]; break;
          case "summary": fields.summary = parsed.data as string; break;
          case "wellnessReferences": fields.wellnessReferences = parsed.data as DiagnosisSingleResponse["wellnessReferences"]; break;
          case "advice": fields.advice = parsed.data as string; break;
          case "safety": fields.safety = parsed.data as string; break;
          case "followUp": fields.followUp = parsed.data as string; break;
        }
      };
      const has = (key: keyof DiagnosisSingleResponse): boolean => fields[key] !== undefined;
      const moduleResult = (index: number): object | undefined => {
        const ready = [
          has("quality") && has("qualityNote") && has("observations"),
          has("summary"),
          has("quality") && has("observations") && has("wellnessReferences") && has("advice"),
          has("quality") && has("safety"),
          has("followUp"),
        ][index];
        if (!ready) return undefined;
        if (fields.quality === "unusable" && fields.observations?.length) throw structuredIssue("图片不可用时不能展示可见观察");
        if (fields.quality === "unusable" && fields.advice) throw structuredIssue("图片不可用时不能展示无依据建议");
        if (fields.quality === "unusable" && fields.wellnessReferences?.length) throw structuredIssue("图片不可用时不能展示传统状态参考");
        const sections = diagnosisSections({
          quality: fields.quality ?? "unusable",
          qualityNote: fields.qualityNote ?? "当前图片不足以支持可见状态观察。",
          observations: fields.observations ?? [],
          summary: fields.summary ?? "",
          wellnessReferences: fields.wellnessReferences ?? [],
          advice: fields.advice ?? "",
          safety: fields.safety ?? "安全说明正在生成。",
          followUp: fields.followUp ?? "",
        }, session.mode);
        const candidate = [sections.visual, sections.summary, sections.wellness, sections.safety, sections.followUp][index];
        const schema = [
          diagnosisVisualObservationsSchema,
          diagnosisObservationSummarySchema,
          diagnosisWellnessRecommendationsSchema,
          diagnosisSafetyLimitationsSchema,
          diagnosisFollowUpQuestionsSchema,
        ][index];
        const parsed = schema?.safeParse(candidate);
        if (!parsed?.success) throw structuredIssue("诊察板块不符合安全展示Schema", parsed?.error);
        return parsed.data as object;
      };
      const publishReadyModules = async (): Promise<void> => {
        while (nextModuleIndex < REPORT_MODULE_IDS.length) {
          let result: object | undefined;
          try {
            result = moduleResult(nextModuleIndex);
          } catch (error) {
            streamIssue = error instanceof TaskError ? error : structuredIssue("诊察板块流式校验失败", error);
            failedModuleId = REPORT_MODULE_IDS[nextModuleIndex];
            return;
          }
          if (!result) return;
          await progress.succeeded(REPORT_MODULE_IDS[nextModuleIndex]!, result);
          nextModuleIndex += 1;
          const nextModuleId = REPORT_MODULE_IDS[nextModuleIndex];
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
          streamIssue = error instanceof TaskError ? error : structuredIssue("诊察流式JSON解析失败", error);
          failedModuleId ??= REPORT_MODULE_IDS[Math.min(nextModuleIndex, REPORT_MODULE_IDS.length - 1)];
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
              streamIssue = error instanceof TaskError ? error : structuredIssue("诊察流式JSON解析失败", error);
              failedModuleId ??= REPORT_MODULE_IDS[Math.min(nextModuleIndex, REPORT_MODULE_IDS.length - 1)];
            }
          }
        }
        if (event.type === "completed") {
          await progress.completeThinking();
          if (!streamIssue) {
            try {
              await acceptFields(parser.finish());
            } catch (error) {
              streamIssue = error instanceof TaskError ? error : structuredIssue("诊察流式JSON未完整闭合", error);
              failedModuleId ??= REPORT_MODULE_IDS[Math.min(nextModuleIndex, REPORT_MODULE_IDS.length - 1)];
            }
          }
        }
        await this.#dependencies.onEvent?.({ ...event, runId });
      };

      await progress.preparing();
      await progress.running("visual-observations");
      const compact = await generateStructuredModule({
        provider: this.#dependencies.provider,
        request: {
          model: "vision",
          output: "json",
          jsonSchema: {
            name: "diagnosis_single_response_v2",
            schema: diagnosisSingleResponseJsonSchema,
            strict: true,
          },
          maxOutputTokens: 4_096,
          messages: [
            { role: "system", content: diagnosisSinglePrompt(session.mode) },
            { role: "user", content: [
              { type: "text", text: "请根据这张图片生成一次紧凑、结构化的可见状态观察。" },
              imageMessage(image),
            ] },
          ],
          onEvent,
        },
        schema: diagnosisSingleResponseSchema,
        validate: (value) => {
          if (streamIssue) throw streamIssue;
          reportResult = validatedReport(value, session.mode);
        },
        repairPrompt: (raw) => diagnosisSingleRepairPrompt(raw, session.mode),
        failureMessage: "诊察报告修复后仍不符合紧凑Schema或安全边界",
        mapInitialError: diagnosisVisualFailure,
        onRepairing: async () => {
          repairingAttempt = true;
          contentStarted = false;
          parser = new TopLevelJsonFieldStream(SINGLE_RESPONSE_KEYS);
          fields = {};
          nextModuleIndex = 0;
          streamIssue = undefined;
          failedModuleId = undefined;
          await progress.restartRepairing(REPORT_MODULE_IDS[0]);
        },
        onValidating: async () => {
          await progress.completeThinking();
          await progress.validatingDocument();
        },
        onFailed: async () => {
          await progress.completeThinking();
          await progress.failed(failedModuleId ?? REPORT_MODULE_IDS[Math.min(nextModuleIndex, REPORT_MODULE_IDS.length - 1)]!);
        },
      });
      fields = compact;
      await publishReadyModules();
      reportResult ??= validatedReport(compact, session.mode);
      await progress.saving();
      await this.#dependencies.repository.saveReport(session.id, reportResult);
      await this.#dependencies.repository.saveRun(session.id, {
        id: runId,
        kind: "diagnosis",
        status: "succeeded",
        startedAt,
        completedAt: new Date().toISOString(),
        rawResponse: "",
        reasoning: "",
        promptVersions: REPORT_PROMPT_VERSIONS,
      });
      return { session, report: reportResult };
    } catch (error) {
      await this.#dependencies.repository.saveRun(sessionId, {
        id: runId, kind: "diagnosis", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse: "", reasoning: "",
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
    try {
      const messages = await this.#conversationMessages(sessionId, report, question.trim());
      const result: AiGenerateResult = await this.#dependencies.provider.generate({
        model: "text",
        output: "text",
        messages,
        maxOutputTokens: DIAGNOSIS_FOLLOW_UP_MAX_OUTPUT_TOKENS,
        onEvent: async (event) => {
          await this.#dependencies.onEvent?.({ ...event, runId });
        },
      });
      const parsed = diagnosisFollowUpReplySchema.safeParse(result.content);
      if (!parsed.success) {
        throw new TaskError({ code: "DIAGNOSIS_FOLLOW_UP_FAILED", message: "追问回复未通过长度或日常观察安全边界校验", action: "retry" });
      }
      const now = new Date().toISOString();
      const userMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "user", content: question.trim(), status: "completed", createdAt: now };
      const assistantMessage: AiMessage = { id: messageId(), sessionId, reportId: session.reportId, role: "assistant", content: parsed.data, status: "completed", createdAt: new Date().toISOString() };
      await this.#dependencies.repository.appendMessages(sessionId, [userMessage, assistantMessage]);
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "succeeded", startedAt, completedAt: new Date().toISOString(), rawResponse: "", reasoning: "" });
      return assistantMessage;
    } catch (error) {
      await this.#dependencies.repository.saveRun(sessionId, { id: runId, kind: "conversation", status: "failed", startedAt, completedAt: new Date().toISOString(), rawResponse: "", reasoning: "", errorCode: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR" });
      throw error;
    }
  }

  async #conversationMessages(sessionId: string, report: import("../../schemas/diagnosis-report").DiagnosisReportV1, question: string): Promise<AiRequestMessage[]> {
    const history = await this.#dependencies.repository.listMessages(sessionId);
    const summary = parsedContextSummary(await this.#dependencies.repository.getContextSummary(sessionId), false);
    const base: AiRequestMessage[] = [
      { role: "system", content: diagnosisConversationPrompt(report) },
      ...(summary ? [{ role: "system" as const, content: `较早对话摘要：${summary}` }] : []),
      ...history.map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
      { role: "user", content: question },
    ];
    const estimatedTokens = estimateWeightedTokens(JSON.stringify(base));
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
      const compressed = parsedContextSummary(result.content, true);
      await this.#dependencies.repository.saveContextSummary(sessionId, compressed);
      return [
        { role: "system", content: diagnosisConversationPrompt(report) },
        { role: "system", content: `较早对话摘要：${compressed}` },
        ...history.slice(-6).map((message) => ({ role: message.role, content: message.content } as AiRequestMessage)),
        { role: "user", content: question },
      ];
    }
    return base;
  }
}
