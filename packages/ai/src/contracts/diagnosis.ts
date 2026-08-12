import type { AiProvider, AiStreamEvent } from "./provider";
import type { StructuredGenerationProgressListener } from "@hongtai/core";
import type { DiagnosisReportV1, ObservationMode } from "../schemas/diagnosis-report";

export interface DiagnosisSession {
  readonly id: string;
  readonly reportId: string;
  readonly mode: ObservationMode;
  readonly createdAt: string;
  /** Safe projection only. Private URI/path/bytes never leave the repository. */
  readonly image: DiagnosisImageMetadata;
}

/** Metadata that can be shown or persisted with a session without exposing media location. */
export interface DiagnosisImageMetadata {
  readonly mimeType: string;
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
  readonly promptVersions?: readonly string[];
  readonly errorCode?: string;
}

export interface DiagnosisReportRunResult {
  readonly session: DiagnosisSession;
  readonly report: DiagnosisReportV1;
}

export interface DiagnosisRepository {
  /**
   * Persists one private image and returns a session projection with only safe
   * image metadata. Implementations must not surface a URI, filesystem path,
   * content-provider authority, or image bytes on the returned session.
   */
  createSession(mode: ObservationMode, image: DiagnosisImageInput): Promise<DiagnosisSession>;
  /** Returns the same safe session projection used by application callers. */
  getSession(sessionId: string): Promise<DiagnosisSession | undefined>;
  /**
   * Flow-only materialization of the image that belongs to an existing session.
   * This is the minimum extra capability required by a Capacitor repository:
   * read private bytes or a private content URI, preserve MIME, and return
   * undefined when the image is unavailable. It must never be forwarded to UI.
   */
  loadSessionImage(sessionId: string): Promise<DiagnosisImageInput | undefined>;
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
  readonly onProgress?: StructuredGenerationProgressListener;
}
