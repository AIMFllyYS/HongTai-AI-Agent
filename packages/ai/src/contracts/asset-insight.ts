import type { AiProvider, AiStreamEvent } from "./provider";

/**
 * One frame handed to the vision model.
 *
 * The URI points at a derivative the platform layer already shrank to the attachment channel's
 * limits; this layer never opens files and never learns where private storage lives.
 */
export interface AssetInsightFrame {
  readonly uri: string;
  readonly mimeType: string;
}

export interface AssetInsightInput {
  readonly assetId: string;
  readonly kind: "image" | "video";
  /**
   * Frames in playback order. Deliberately no requirement text, no filename and no brief: telling
   * the model what we hoped to see turns a description into a confirmation, and this document is
   * only worth having if it can disagree with the plan.
   */
  readonly frames: readonly AssetInsightFrame[];
}

export interface AssetInsightFlowDependencies {
  readonly provider: AiProvider;
  readonly onEvent?: (event: AiStreamEvent) => void | Promise<void>;
}
