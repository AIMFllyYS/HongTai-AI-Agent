import {
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
  MAX_SHOTS_PER_PRODUCTION,
  MIN_PRODUCTION_DURATION_SECONDS,
  MIN_SHOT_DURATION_SECONDS,
  SUBTITLE_TEMPLATE_IDS,
} from "@hongtai/core";
import { z } from "zod";

import { toProviderJsonSchema } from "../structured-output/json-schema";

/**
 * What a user would have to film to rebuild a breakdown, one shot at a time.
 *
 * This is a shopping list, not a plan: it names the material each shot needs so the user knows what
 * to shoot, and it deliberately carries no `assetId`, because nothing has been imported yet. Shot
 * count and durations stay inside the production bounds so the list never describes a video no plan
 * could hold — but turning it into a plan still needs the suggested seconds fitted to the target
 * duration the user picks, since a plan's shots must sum to it exactly.
 */

/** Mirrors the analysis's narrative roles, so a shot can be traced back to the段 it came from. */
export const REPLICA_SHOT_ROLES = ["opening", "development", "proof", "transition", "closing", "other"] as const;

/**
 * Who or what has to be in frame. Bounded on purpose: a free-text role invites the model to invent
 * staff, customers and props the evidence never mentioned, and the user cannot check a claim like
 * "店长出镜" against a transcript.
 */
export const REPLICA_SHOT_SUBJECTS = ["operator", "customer", "product", "environment", "document", "other"] as const;

export const REPLICA_MATERIAL_KINDS = ["image", "video"] as const;

export const replicaMaterialSchema = z.object({
  kind: z.enum(REPLICA_MATERIAL_KINDS),
  /** What to point the camera at, in the user's own terms. */
  contentHint: z.string().min(1).max(60),
  /** Whole seconds: a shopping list the user reads, not a render timeline. */
  suggestedDurationSeconds: z.number().int().min(MIN_SHOT_DURATION_SECONDS).max(MAX_SHOT_DURATION_SECONDS),
});

export const replicaShotSchema = z.object({
  order: z.number().int().positive(),
  role: z.enum(REPLICA_SHOT_ROLES),
  subject: z.enum(REPLICA_SHOT_SUBJECTS),
  visualDescription: z.string().min(1).max(120),
  material: replicaMaterialSchema,
  /** A starting point for the narration, not finished copy: the user still rewrites it. */
  scriptDraft: z.string().min(1).max(160),
  /**
   * At least one real evidence id, so every shot can be traced back to something that was actually
   * said. This bounds where a shot came from, not what it claims: a transcript describes speech, so
   * no check here can confirm that `visualDescription` matches the original framing. Keeping the
   * description to what the user can film themselves is a prompt rule, not a validated one.
   */
  evidenceRefs: z.array(z.string().min(1)).min(1).max(8),
});

export const replicaBlueprintResponseSchema = z.object({
  /** One sentence on what makes this worth rebuilding, for the wizard's opening line. */
  premise: z.string().min(1).max(160),
  /**
   * One template for the whole video, because `production-plan.v3` burns a single template per
   * export. Per-shot templates would promise something the renderer cannot do.
   */
  suggestedTemplateId: z.enum(SUBTITLE_TEMPLATE_IDS),
  shots: z.array(replicaShotSchema).max(MAX_SHOTS_PER_PRODUCTION),
  /** Required when `shots` is empty: why the evidence could not support a single shot. */
  emptyReason: z.string().min(1).max(160).nullable(),
}).strict();

export const replicaBlueprintResultSchema = z.object({
  schemaVersion: z.literal("replica-blueprint.v1"),
  source: z.object({
    analysisTaskId: z.string().min(1),
    analysisSchemaVersion: z.literal("content-analysis.v1"),
  }),
  premise: replicaBlueprintResponseSchema.shape.premise,
  subtitle: z.object({
    templateId: z.enum(SUBTITLE_TEMPLATE_IDS),
    /** The template the model asked for when it needed word timing this document cannot promise. */
    degradedFromTemplateId: z.enum(SUBTITLE_TEMPLATE_IDS).nullable(),
  }),
  shots: replicaBlueprintResponseSchema.shape.shots,
  emptyReason: replicaBlueprintResponseSchema.shape.emptyReason,
});

export type ReplicaMaterial = z.infer<typeof replicaMaterialSchema>;
export type ReplicaShot = z.infer<typeof replicaShotSchema>;
export type ReplicaBlueprintResponse = z.infer<typeof replicaBlueprintResponseSchema>;
export type ReplicaBlueprintResultV1 = z.infer<typeof replicaBlueprintResultSchema>;

export const replicaBlueprintResponseJsonSchema = toProviderJsonSchema(replicaBlueprintResponseSchema);

export const REPLICA_BLUEPRINT_BOUNDS = {
  maxShots: MAX_SHOTS_PER_PRODUCTION,
  minShotSeconds: MIN_SHOT_DURATION_SECONDS,
  maxShotSeconds: MAX_SHOT_DURATION_SECONDS,
  minTotalSeconds: MIN_PRODUCTION_DURATION_SECONDS,
  maxTotalSeconds: MAX_PRODUCTION_DURATION_SECONDS,
} as const;
