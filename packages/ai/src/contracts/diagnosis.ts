import type { AiProvider, AiStreamEvent } from "./provider";
import type { DiagnosisReportV1, ObservationMode } from "../schemas/diagnosis-report";

export interface DiagnosisSession {
  readonly id: string;
  readonly reportId: string;
  readonly mode: ObservationMode;
  readonly createdAt: string;
  readonly imagePath: string;
}

export type DiagnosisImageInput = {
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly uri?: never;
} | {
  readonly mimeType: string;
  readonly uri: string;
  readonly data?: never;
};

export interface AiMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly reportId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "completed" | "failed";
  readonly createdAt: string;
}

export interface AiRunRecord {
  readonly id: string;
  readonly kind: "diagnosis" | "conversation" | "context-summary";
  readonly status: "succeeded" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rawResponse: string;
  readonly reasoning: string;
  readonly errorCode?: string;
}

export interface DiagnosisRepository {
  createSession(mode: ObservationMode, image: DiagnosisImageInput): Promise<DiagnosisSession>;
  getSession(sessionId: string): Promise<DiagnosisSession | undefined>;
  saveReport(sessionId: string, report: DiagnosisReportV1): Promise<void>;
  getReport(sessionId: string): Promise<DiagnosisReportV1 | undefined>;
  listMessages(sessionId: string): Promise<readonly AiMessage[]>;
  appendMessages(sessionId: string, messages: readonly AiMessage[]): Promise<void>;
  getContextSummary(sessionId: string): Promise<string>;
  saveContextSummary(sessionId: string, summary: string): Promise<void>;
  saveRun(sessionId: string, run: AiRunRecord): Promise<void>;
}

export interface DiagnosisFlowDependencies {
  readonly provider: AiProvider;
  readonly repository: DiagnosisRepository;
  readonly contextWindowTokens: number;
  readonly onEvent?: (event: AiStreamEvent & { readonly runId: string }) => void | Promise<void>;
}
