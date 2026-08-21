import { MIN_MONTAGE_VISUAL_ASSETS } from "./production-bounds";
import type { ProductionAssetRole, ProductionMode } from "./application-runtime";

/**
 * Shared "can this project even start planning" facts.
 *
 * The planning flow, the production service and the create screen all gate on the same
 * visual-count and avatar-duration rules. User-facing copy and TaskError codes stay at the
 * caller: this module only names the reason.
 */
export type ProductionPlanReadinessReason =
  | "need-visuals"
  | "need-avatar-video"
  | "avatar-too-short"
  | "need-avatar-script";

export interface ProductionPlanReadinessOk {
  readonly ok: true;
}

export interface ProductionPlanReadinessBlocked {
  readonly ok: false;
  readonly reason: ProductionPlanReadinessReason;
  readonly missingVisualCount?: number;
  readonly targetDurationSeconds?: number;
}

export type ProductionPlanReadiness = ProductionPlanReadinessOk | ProductionPlanReadinessBlocked;

export interface ProductionPlanReadinessAsset {
  readonly role?: ProductionAssetRole;
  /** Media kind from the project record; documents never count as montage pictures. */
  readonly kind?: string;
  readonly durationSeconds?: number;
}

export interface ProductionPlanReadinessInput {
  readonly mode: ProductionMode;
  readonly assets: readonly ProductionPlanReadinessAsset[];
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
}

function resolvedRole(asset: ProductionPlanReadinessAsset): ProductionAssetRole {
  if (asset.role) return asset.role;
  return asset.kind === "audio" ? "music" : "visual";
}

/** Audio is never a montage picture, even if a stale record forgot to stamp `role`. */
export function isMontageVisualAsset(asset: ProductionPlanReadinessAsset): boolean {
  return resolvedRole(asset) === "visual" && asset.kind !== "audio";
}

export function isAvatarVideoAsset(asset: ProductionPlanReadinessAsset): boolean {
  return resolvedRole(asset) === "avatar" && asset.kind === "video";
}

/**
 * Avatar source length must cover the chosen target. The 1ms slack matches the native
 * millisecond clock so a probe of exactly N seconds is accepted for an N-second project.
 */
export function avatarDurationCoversTarget(durationSeconds: number | undefined, targetDurationSeconds: number): boolean {
  return durationSeconds !== undefined && durationSeconds + 0.001 >= targetDurationSeconds;
}

export function inspectProductionPlanReadiness(input: ProductionPlanReadinessInput): ProductionPlanReadiness {
  if (input.mode === "avatar") {
    const avatars = input.assets.filter(isAvatarVideoAsset);
    if (avatars.length !== 1) return { ok: false, reason: "need-avatar-video" };
    if (!avatarDurationCoversTarget(avatars[0]?.durationSeconds, input.targetDurationSeconds)) {
      return { ok: false, reason: "avatar-too-short", targetDurationSeconds: input.targetDurationSeconds };
    }
    if (!input.avatarScript?.trim()) return { ok: false, reason: "need-avatar-script" };
    return { ok: true };
  }

  const visualCount = input.assets.filter(isMontageVisualAsset).length;
  if (visualCount < MIN_MONTAGE_VISUAL_ASSETS) {
    return { ok: false, reason: "need-visuals", missingVisualCount: MIN_MONTAGE_VISUAL_ASSETS - visualCount };
  }
  return { ok: true };
}
