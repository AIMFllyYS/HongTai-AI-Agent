import { z } from "zod";

import { toProviderJsonSchema } from "../structured-output/json-schema";
import { rejectDiagnosisStructuralOverreach } from "./diagnosis-medical-boundary";
import { REPLICA_SHOT_SUBJECTS } from "./replica-blueprint";

/**
 * What one imported asset actually shows, so planning stops matching narration to a filename.
 *
 * This document is deliberately thin. It records only what a viewer would see in the frames that
 * were sent, because everything richer — brand, place, price, who the person is — is a guess the
 * user cannot check against the picture, and a wrong guess ends up spoken aloud in the video.
 */

/**
 * Frames one asset may contribute. A still contributes one; a clip contributes its start, middle
 * and end, which is enough to notice that a shot changes subject without paying for a full decode.
 */
export const MAX_INSIGHT_FRAMES = 3;

export const assetInsightResponseSchema = z.object({
  /** Plainly visible content, in the words a shop owner would use. */
  description: z.string().min(1).max(120).superRefine(rejectDiagnosisStructuralOverreach),
  /**
   * The same closed vocabulary a blueprint requirement uses, so "what the list asked for" and
   * "what the frame shows" are comparable values rather than two free-text sentences.
   */
  subject: z.enum(REPLICA_SHOT_SUBJECTS),
  /** Single words for the planner to reuse; a sentence here would be copied into narration. */
  tags: z.array(z.string().min(1).max(12)).max(6),
  /** False when the frames cannot carry a shot at all: too dark, too blurry, or nothing in them. */
  usable: z.boolean(),
  /** Required when `usable` is false, so the user is told what to reshoot. */
  unusableReason: z.string().min(1).max(80).nullable(),
}).strict();

export const assetInsightResultSchema = assetInsightResponseSchema.extend({
  schemaVersion: z.literal("asset-insight.v1"),
  assetId: z.string().min(1),
  /**
   * How many frames were actually described. A one-frame reading of a 20 second clip is still a
   * real reading, but it is not the same claim as having watched the whole thing.
   */
  describedFrameCount: z.number().int().min(1).max(MAX_INSIGHT_FRAMES),
});

export type AssetInsightResponse = z.infer<typeof assetInsightResponseSchema>;
export type AssetInsightResultV1 = z.infer<typeof assetInsightResultSchema>;

export const assetInsightResponseJsonSchema = toProviderJsonSchema(assetInsightResponseSchema);

export const ASSET_INSIGHT_BOUNDS = {
  maxFrames: MAX_INSIGHT_FRAMES,
  maxDescriptionCharacters: 120,
  maxTags: 6,
  maxTagCharacters: 12,
} as const;
