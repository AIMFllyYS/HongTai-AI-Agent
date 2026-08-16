import { createRuntimeId, TaskError } from "@hongtai/core";
import type { StructuredGenerationModuleId } from "@hongtai/core";
import type { AiGenerateResult, AiStreamEvent } from "../../contracts/provider";
import type {
  AiMessage,
  DiagnosisFlowDependencies,
  DiagnosisImageInput,
  DiagnosisReportRunResult,
  DiagnosisSession,
} from "../../contracts/diagnosis";
import {
  DIAGNOSIS_FOLLOW_UP_MAX_OUTPUT_TOKENS,
  diagnosisFollowUpReplySchema,
} from "../../schemas/diagnosis-follow-up";
import {
  diagnosisSingleResponseJsonSchema,
  diagnosisSingleResponseSchema,
  type DiagnosisReportV1,
  type DiagnosisSingleResponse,
  type ObservationMode,
} from "../../schemas/diagnosis-report";
import {
  diagnosisSinglePrompt,
  diagnosisSingleRepairPrompt,
} from "../../prompts/diagnosis-report-single";
import { generateStructuredModule } from "../../structured-output/generate-structured-module";
import { StructuredGenerationProgressTracker } from "../../structured-output/structured-generation-progress";
import { TopLevelJsonFieldStream, type CompletedTopLevelJsonField } from "../../structured-output/top-level-json-field-stream";
import { conversationMessagesForFollowUp } from "./diagnosis-context-compression";
import {
  acceptDiagnosisField,
  diagnosisModuleResult,
  REPORT_MODULE_IDS,
  REPORT_PROMPT_VERSIONS,
  SINGLE_RESPONSE_KEYS,
  structuredIssue,
  validatedReport,
} from "./diagnosis-report-sections";

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

      const publishReadyModules = async (): Promise<void> => {
        while (nextModuleIndex < REPORT_MODULE_IDS.length) {
          let result: object | undefined;
          try {
            result = diagnosisModuleResult(fields, session.mode, nextModuleIndex);
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
            acceptDiagnosisField(fields, field);
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
      const messages = await conversationMessagesForFollowUp(this.#dependencies, sessionId, report, question.trim());
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
}
