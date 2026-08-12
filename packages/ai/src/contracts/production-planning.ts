import type { ContentAnalysisResultV1 } from "../schemas/content-analysis";
import type { ProductionPlanResultV1 } from "../schemas/production-plan";
import type { AiProvider, AiStreamEvent } from "./provider";

export interface ProductionPlanningAsset {
  readonly id: string;
  readonly kind: "image" | "video" | "audio";
  readonly role: "visual" | "avatar" | "music";
  readonly mimeType: string;
  readonly displayName: string;
  readonly durationSeconds?: number;
}

export interface ProductionPlanInput {
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: "montage" | "avatar";
  /** User-provided script that must match the uploaded avatar video. */
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
  readonly analysis: ContentAnalysisResultV1;
  readonly assets: readonly ProductionPlanningAsset[];
}

export interface ProductionPlanningFlowDependencies {
  readonly provider: AiProvider;
  readonly onEvent?: (event: AiStreamEvent) => void | Promise<void>;
}

export interface ProductionPlanStore {
  savePlan(projectId: string, plan: ProductionPlanResultV1): Promise<void>;
}
