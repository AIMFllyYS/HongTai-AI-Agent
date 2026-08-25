import { diagnosisReportSchema } from "@hongtai/ai";
import type {
  AiMessage,
  AiRunRecord,
  DiagnosisImageInput,
  DiagnosisReportV1,
  DiagnosisRepository,
  DiagnosisSession,
} from "@hongtai/ai";
import { TaskError } from "@hongtai/core";
import type { DiagnosisMessage, ObservationMode } from "@hongtai/core";

export const SESSION_PATH = "session.json";
export const REPORT_PATH = "report.json";
export const MESSAGES_PATH = "messages.json";
export const CONTEXT_PATH = "context.txt";

export interface StandaloneObservationFilesPlugin {
  ensureObservation(options: { readonly sessionId: string }): Promise<void>;
  writeObservationText(options: {
    readonly sessionId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  readObservationText(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listObservationIds(): Promise<{ readonly sessionIds: readonly string[] }>;
  deleteObservation(options: { readonly sessionId: string }): Promise<void>;
  copyToObservation(options: { readonly sessionId: string; readonly sourceUri: string; readonly relativePath: string }): Promise<{
    readonly uri: string;
    readonly sizeBytes: number;
    readonly mimeType?: string;
  }>;
  getObservationUri(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{
    readonly uri?: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
}

function taskError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string, action: ConstructorParameters<typeof TaskError>[0]["action"] = "none"): TaskError {
  return new TaskError({ code, message, action });
}

export function createStandaloneDiagnosisRepository(options: {
  readonly files: StandaloneObservationFilesPlugin;
  readonly readSession: (sessionId: string) => Promise<{
    readonly sessionId: string;
    readonly reportId: string;
    readonly mode: ObservationMode;
    readonly image: { readonly relativePath: string; readonly mimeType: string };
    readonly createdAt: string;
  } | undefined>;
  readonly setSucceeded: (state: {
    readonly sessionId: string;
    readonly reportId: string;
    readonly mode: ObservationMode;
    readonly image: { readonly relativePath: string; readonly mimeType: string };
    readonly createdAt: string;
  }) => Promise<void>;
  readonly listMessages: (sessionId: string) => Promise<readonly DiagnosisMessage[]>;
  readonly createFromFlow: (mode: ObservationMode, image: DiagnosisImageInput) => Promise<{
    readonly sessionId: string;
    readonly createdAt: string;
    readonly image: { readonly mimeType: string };
  }>;
  readonly parseJson: (value: string) => unknown;
}): DiagnosisRepository {
  return {
    createSession: async (mode, image) => {
      const synthetic = await options.createFromFlow(mode, image);
      return { id: synthetic.sessionId, reportId: `report-${synthetic.sessionId}`, mode, createdAt: synthetic.createdAt, image: { mimeType: synthetic.image.mimeType } };
    },
    getSession: async (sessionId): Promise<DiagnosisSession | undefined> => {
      const state = await options.readSession(sessionId);
      return state ? { id: state.sessionId, reportId: state.reportId, mode: state.mode, createdAt: state.createdAt, image: { mimeType: state.image.mimeType } } : undefined;
    },
    loadSessionImage: async (sessionId): Promise<DiagnosisImageInput | undefined> => {
      const state = await options.readSession(sessionId);
      if (!state) return undefined;
      const image = await options.files.getObservationUri({ sessionId, relativePath: state.image.relativePath });
      return image.uri ? { uri: image.uri, mimeType: state.image.mimeType } : undefined;
    },
    saveReport: async (sessionId, value) => {
      const state = await options.readSession(sessionId);
      if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话");
      await options.files.writeObservationText({ sessionId, relativePath: REPORT_PATH, value: JSON.stringify(value), replace: true });
      await options.setSucceeded(state);
    },
    getReport: async (sessionId): Promise<DiagnosisReportV1 | undefined> => {
      const raw = await options.files.readObservationText({ sessionId, relativePath: REPORT_PATH });
      const parsed = raw.value ? diagnosisReportSchema.safeParse(options.parseJson(raw.value)) : undefined;
      return parsed?.success ? parsed.data : undefined;
    },
    listMessages: async (sessionId): Promise<readonly AiMessage[]> => {
      const state = await options.readSession(sessionId);
      if (!state) return [];
      return (await options.listMessages(sessionId)).map((message) => ({
        id: message.id,
        sessionId,
        reportId: state.reportId,
        role: message.role,
        content: message.content,
        status: message.status === "failed" ? "failed" : "completed",
        createdAt: message.createdAt,
      }));
    },
    appendMessages: async (sessionId, messages) => {
      const existing = await options.listMessages(sessionId);
      const state = await options.readSession(sessionId);
      if (!state) throw taskError("AI_SESSION_NOT_FOUND", "未找到本地观察会话");
      const combined = [...existing, ...messages.map((message) => ({
        id: message.id,
        sessionId,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      }))];
      await options.files.writeObservationText({ sessionId, relativePath: MESSAGES_PATH, value: JSON.stringify(combined), replace: true });
    },
    getContextSummary: async (sessionId) => (await options.files.readObservationText({ sessionId, relativePath: CONTEXT_PATH })).value ?? "",
    saveContextSummary: async (sessionId, summary) => {
      await options.files.writeObservationText({ sessionId, relativePath: CONTEXT_PATH, value: summary, replace: true });
    },
    // Prompt and provider reasoning are deliberately runtime-only and never
    // persisted in application files or the formal observation report.
    saveRun: async (_sessionId: string, _run: AiRunRecord) => {
      void _sessionId;
      void _run;
    },
  };
}
