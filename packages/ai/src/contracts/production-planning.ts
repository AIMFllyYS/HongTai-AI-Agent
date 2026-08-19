import type { ContentAnalysisResultV1 } from "../schemas/content-analysis";
import type { AiProvider, AiStreamEvent } from "./provider";

/**
 * Why the user filmed this asset, when it came from a replica blueprint requirement.
 *
 * The planner may not reassign it: the user shot this clip for this item, so the plan has to put it
 * where the list said it goes, otherwise the checklist they followed was decoration.
 */
export interface ProductionAssetRequirement {
  readonly order: number;
  readonly visualDescription: string;
  readonly contentHint: string;
  readonly suggestedDurationSeconds: number;
}

export interface ProductionPlanningAsset {
  readonly id: string;
  readonly kind: "image" | "video" | "audio";
  readonly role: "visual" | "avatar" | "music";
  readonly mimeType: string;
  readonly displayName: string;
  readonly durationSeconds?: number;
  readonly requirement?: ProductionAssetRequirement;
}

export interface ProductionPlanInput {
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: "montage" | "avatar";
  /** Bounded original transcript or image text. It is reference-only and never persisted in a production project. */
  readonly originalSourceText: string;
  /** Optional user override; blank lets the planner generate a short main line. */
  readonly headlineText?: string;
  readonly textPreset: "classic_top" | "clean_card" | "aqua_accent";
  /** Subtitle template the user picked; the plan must reference exactly this one. */
  readonly subtitleTemplateId?: string;
  /** Decoration manifest ids the planner may reference. Empty or absent forbids decorations. */
  readonly allowedDecorationIds?: readonly string[];
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
