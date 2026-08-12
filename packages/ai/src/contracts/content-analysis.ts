import type { ContentAnalysisPlatform, ContentType } from "@hongtai/core";
import type { AiProvider, AiStreamEvent } from "./provider";
import type { ContentAnalysisResultV1 } from "../schemas/content-analysis";

export interface ContentEvidenceUnit {
  readonly id: string;
  readonly text: string;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
}

export interface ContentAnalysisInput {
  readonly taskId: string;
  readonly platform: ContentAnalysisPlatform;
  readonly contentType: Extract<ContentType, "video" | "image_text">;
  readonly sourceKind: "asr" | "description" | "image_text";
  readonly title?: string;
  readonly author?: string;
  readonly evidenceUnits: readonly ContentEvidenceUnit[];
}

export interface ContentAnalysisRunRecord {
  readonly id: string;
  readonly status: "succeeded" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rawResponse: string;
  readonly reasoning: string;
  readonly errorCode?: string;
}

export interface ContentAnalysisStore {
  loadInput(taskId: string): Promise<ContentAnalysisInput>;
  saveResult(taskId: string, result: ContentAnalysisResultV1, run: ContentAnalysisRunRecord): Promise<void>;
  saveFailedRun(taskId: string, run: ContentAnalysisRunRecord): Promise<void>;
}

export interface ContentAnalysisFlowDependencies {
  readonly provider: AiProvider;
  readonly store: ContentAnalysisStore;
  readonly onEvent?: (event: AiStreamEvent & { readonly runId: string }) => void | Promise<void>;
}
