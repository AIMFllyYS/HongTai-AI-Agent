import { MIN_MONTAGE_VISUAL_ASSETS } from "./production-bounds";
import type { ProductionAssetRole, ProductionMode } from "./application-runtime";
import type { ScriptStoryboard } from "./script-storyboard";
import type { TtsTimedTrack } from "./tts-timed-track";

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

/**
 * v4 分镜脚本就绪检查：进入配音阶段前，脚本必须已生成且至少有一句口播。
 * 用户可按稳定 reason 分支展示文案；reason 命名沿用本文件的 kebab-case 惯例。
 */
export type ScriptStoryboardReadinessReason = "need-storyboard-sentences";

export interface ScriptStoryboardReadinessOk {
  readonly ok: true;
}

export interface ScriptStoryboardReadinessBlocked {
  readonly ok: false;
  readonly reason: ScriptStoryboardReadinessReason;
}

export type ScriptStoryboardReadiness = ScriptStoryboardReadinessOk | ScriptStoryboardReadinessBlocked;

export function inspectScriptStoryboardReadiness(input: {
  /** 尚未生成分镜脚本时省略。 */
  readonly storyboard?: ScriptStoryboard;
}): ScriptStoryboardReadiness {
  if (!input.storyboard || input.storyboard.sentences.length === 0) {
    return { ok: false, reason: "need-storyboard-sentences" };
  }
  return { ok: true };
}

/**
 * v4 配音就绪检查：合成阶段只消费已就绪音频，所以每一句分镜都必须有对应的实测音轨，
 * 音轨也只能挂在真实存在的句子上（多余或重复都说明状态与脚本脱节）。
 */
export type NarrationReadinessReason =
  | "need-storyboard-sentences"
  | "need-narration-tracks"
  | "narration-track-mismatch";

export interface NarrationReadinessOk {
  readonly ok: true;
}

export interface NarrationReadinessBlocked {
  readonly ok: false;
  readonly reason: NarrationReadinessReason;
  /** 尚未配音的句子 id（need-narration-tracks 时给出，供单句重试入口定位）。 */
  readonly missingSentenceIds?: readonly string[];
  /** 引用异常的句子 id（narration-track-mismatch：多余或重复的音轨）。 */
  readonly mismatchedSentenceIds?: readonly string[];
}

export type NarrationReadiness = NarrationReadinessOk | NarrationReadinessBlocked;

export function inspectNarrationReadiness(input: {
  /** 配音的前提是分镜脚本已就绪；脚本缺失或为空时先报脚本未就绪。 */
  readonly storyboard?: ScriptStoryboard;
  readonly tracks: readonly TtsTimedTrack[];
}): NarrationReadiness {
  const storyboardReady = inspectScriptStoryboardReadiness({ storyboard: input.storyboard });
  if (!storyboardReady.ok) return { ok: false, reason: "need-storyboard-sentences" };

  const expectedIds = new Set((input.storyboard?.sentences ?? []).map((sentence) => sentence.id));
  const covered = new Set<string>();
  const mismatchedSentenceIds: string[] = [];
  for (const track of input.tracks) {
    if (!expectedIds.has(track.sentenceId) || covered.has(track.sentenceId)) {
      if (!mismatchedSentenceIds.includes(track.sentenceId)) mismatchedSentenceIds.push(track.sentenceId);
      continue;
    }
    covered.add(track.sentenceId);
  }
  if (mismatchedSentenceIds.length > 0) {
    return { ok: false, reason: "narration-track-mismatch", mismatchedSentenceIds };
  }

  const missingSentenceIds = [...expectedIds].filter((id) => !covered.has(id));
  if (missingSentenceIds.length > 0) {
    return { ok: false, reason: "need-narration-tracks", missingSentenceIds };
  }
  return { ok: true };
}
