import { productionPlanResultSchema, type ProductionPlanningAsset, type ProductionPlanResult } from "@hongtai/ai";
import {
  MAX_SHOTS_PER_PRODUCTION,
  parseScriptStoryboard,
  parseTtsTimedTrack,
  PRODUCTION_TEXT_PRESET_VALUES,
  subtitleTemplateById,
  type ProductionAsset,
  type ProductionAssetRole,
  type ProductionMode,
  type ProductionProjectRecord,
  type ProductionTextPreset,
  type JsonObject,
  type ScriptStoryboard,
  type TaskIssue,
  type TaskService,
  type TtsTimedTrack,
} from "@hongtai/core";

import type { NativeProductionAsset, NativeProductionResult } from "./standalone-bridge.js";
import { productionArtifactError } from "./standalone-production-native-errors.js";

export const PROJECT_PATH = "project.json";
export const PLAN_PATH = "plan.json";

export interface ProductionFilesPort {
  ensureProduction(options: { readonly projectId: string }): Promise<void>;
  writeProductionText(options: { readonly projectId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }): Promise<void>;
  readProductionText(options: { readonly projectId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listProductionIds(): Promise<{ readonly projectIds: readonly string[] }>;
  deleteProductionFile(options: { readonly projectId: string; readonly relativePath: string }): Promise<void>;
  deleteProduction(options: { readonly projectId: string }): Promise<void>;
}

/**
 * What a vision model saw in this asset, kept next to the asset so a re-plan does not pay for the
 * same call twice. Only the descriptive half reaches the planner; `usable` and `unusableReason` are
 * a message for the user about reshooting.
 */
export interface PersistedInsight {
  readonly description: string;
  readonly subject: string;
  readonly tags: readonly string[];
  readonly usable: boolean;
  readonly unusableReason: string | null;
  readonly describedFrameCount: number;
}

export interface PersistedAsset extends NativeProductionAsset {
  readonly requirementOrder?: number;
  readonly insight?: PersistedInsight;
}

/** v4 管线：一句分镜已合成的音频，`audioPath` 为项目内相对路径（native 回传）。 */
export interface PersistedNarrationAsset {
  readonly sentenceId: string;
  readonly audioPath: string;
}

export interface PersistedProject {
  readonly projectId: string;
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly mode: ProductionMode;
  readonly headlineText?: string;
  readonly textPreset: ProductionTextPreset;
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
  readonly status: ProductionProjectRecord["status"];
  readonly assets: readonly PersistedAsset[];
  /**
   * Which requirement the picker was opened for. Written before the external Activity starts,
   * because a WebView rebuild would otherwise return a file with nothing saying what it is for.
   */
  readonly pendingRequirementOrder?: number;
  readonly plan?: ProductionPlanResult;
  /**
   * v4（文稿先行）管线：已确认的分镜脚本。字段存在即表示该项目走 v4 路径——存量 v3
   * 项目没有它，v3 行为不受影响。
   */
  readonly storyboard?: ScriptStoryboard;
  /**
   * v4 管线：逐句实测 TTS 音轨（时长证据）。与 `narrationAssets` 按 `sentenceId` 成对
   * 写入：一句只有在两边都存在时才算「已就绪」，缺任何一半都需要重新合成该句。
   */
  readonly narrationTracks?: readonly TtsTimedTrack[];
  /** v4 管线：逐句已合成音频文件（项目内相对路径），渲染的「音频已就绪」路径只消费它。 */
  readonly narrationAssets?: readonly PersistedNarrationAsset[];
  readonly output?: NativeProductionResult;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * 内连接 `narrationTracks` 与 `narrationAssets`：只保留音轨与音频文件同时存在的句子。
 * 重复的句子 id 取先出现的一条（与就绪检查的「多余即异常」语义一致，这里不给重复
 * 机会进入渲染）；一半存在一半缺失说明记录损坏，按「未就绪、可重试」处理。
 */
export function pairedNarration(project: PersistedProject): ReadonlyMap<string, { readonly track: TtsTimedTrack; readonly audioPath: string }> {
  const assetsBySentence = new Map<string, string>();
  for (const asset of project.narrationAssets ?? []) {
    if (!assetsBySentence.has(asset.sentenceId)) assetsBySentence.set(asset.sentenceId, asset.audioPath);
  }
  const paired = new Map<string, { readonly track: TtsTimedTrack; readonly audioPath: string }>();
  for (const track of project.narrationTracks ?? []) {
    const audioPath = assetsBySentence.get(track.sentenceId);
    if (audioPath !== undefined && !paired.has(track.sentenceId)) paired.set(track.sentenceId, { track, audioPath });
  }
  return paired;
}

export function defaultAssetRole(value: Pick<NativeProductionAsset, "kind">): ProductionAssetRole {
  return value.kind === "audio" ? "music" : "visual";
}

/**
 * Projects an asset field by field for the planner, which also decides what reaches the provider:
 * the whole record would carry the private file URI, the stored byte count and the reshoot verdict
 * into the prompt, none of which a model needs to write a shot list.
 *
 * An unusable frame contributes no description at all. "We looked and saw nothing" is not grounding,
 * so the plan must not count that asset as described.
 */
export function planningAsset(asset: PersistedAsset): ProductionPlanningAsset {
  const insight = asset.insight?.usable === true ? asset.insight : undefined;
  return {
    id: asset.id,
    kind: asset.kind,
    role: asset.role ?? defaultAssetRole(asset),
    mimeType: asset.mimeType,
    displayName: asset.displayName,
    ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
    ...(insight ? { insight: { description: insight.description, subject: insight.subject, tags: insight.tags } } : {}),
  };
}

/**
 * Hands the renderer the subtitle template the plan already committed to. The template is looked
 * up rather than re-resolved, because degrading a template that needs word-level timing is a
 * planning decision that must already be recorded in the plan the user approved.
 */
export function subtitleTemplatePayload(plan: ProductionPlanResult): { readonly subtitleTemplateJson?: string } {
  if (plan.schemaVersion !== "production-plan.v3" && plan.schemaVersion !== "production-plan.v4") return {};
  return { subtitleTemplateJson: JSON.stringify(subtitleTemplateById(plan.subtitle.templateId)) };
}

export function originalSourceText(detail: Awaited<ReturnType<TaskService["getDetail"]>>): string | undefined {
  const direct = detail?.transcript?.text?.trim() || detail?.imageText?.text?.trim();
  const evidence = detail?.evidenceUnits.map((unit) => unit.text.trim()).filter(Boolean).join("\n");
  const value = (direct || evidence)?.replace(/\s+/gu, " ").trim();
  return value ? value.slice(0, 12_000) : undefined;
}

/** A requirement number that could not have come from a blueprint would bind an asset to nothing. */
export function isRequirementOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SHOTS_PER_PRODUCTION;
}

function unreadablePlanIssue(): TaskIssue {
  return {
    code: "PRODUCTION_PLAN_UNREADABLE",
    severity: "error",
    userMessage: "这份制作计划已经无法读取，项目和素材都还在。请重新生成计划，或删除这个项目。",
    retryable: true,
    action: "retry",
  };
}

export function persistedAsset(value: PersistedAsset): PersistedAsset | undefined {
  const base = nativeAsset(value);
  if (!base) return undefined;
  const insight = persistedInsight(value.insight);
  if (value.requirementOrder === undefined) return insight ? { ...base, insight } : base;
  if (!isRequirementOrder(value.requirementOrder)) return undefined;
  return { ...base, requirementOrder: value.requirementOrder, ...(insight ? { insight } : {}) };
}

/**
 * A malformed insight is dropped rather than failing the read: it is a cached observation, and
 * losing it only costs one more vision call, whereas rejecting the record would make the project
 * unopenable over something that never affected the render.
 */
export function persistedInsight(value: unknown): PersistedInsight | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PersistedInsight>;
  const { description, subject, usable, unusableReason, describedFrameCount } = candidate;
  if (typeof description !== "string" || !description.trim() || typeof subject !== "string" || !subject.trim()) return undefined;
  if (typeof usable !== "boolean" || !(typeof unusableReason === "string" || unusableReason === null)) return undefined;
  if (!Number.isInteger(describedFrameCount) || (describedFrameCount ?? 0) < 1) return undefined;
  const tags = Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
  return { description, subject, tags, usable, unusableReason, describedFrameCount: describedFrameCount as number };
}

export function nativeAsset(value: NativeProductionAsset): NativeProductionAsset | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value.id) || !value.uri || !value.displayName || value.sizeBytes <= 0) return undefined;
  if (value.kind === "image" && !["image/jpeg", "image/png", "image/webp"].includes(value.mimeType)) return undefined;
  if (value.kind === "video" && value.mimeType !== "video/mp4") return undefined;
  if (value.kind === "audio" && !["audio/mpeg", "audio/mp4", "audio/wav"].includes(value.mimeType)) return undefined;
  const role = value.role ?? defaultAssetRole(value);
  if (!(["visual", "avatar", "music"] as const).includes(role)) return undefined;
  if (role === "avatar" && value.kind !== "video") return undefined;
  if (role === "music" && value.kind !== "audio") return undefined;
  if (role === "visual" && value.kind === "audio") return undefined;
  return { ...value, role };
}

export function assetPath(asset: NativeProductionAsset): string {
  const extension = asset.mimeType === "image/jpeg" ? "jpg"
    : asset.mimeType === "image/png" ? "png"
      : asset.mimeType === "image/webp" ? "webp"
        : asset.mimeType === "video/mp4" ? "mp4"
          : asset.mimeType === "audio/mpeg" ? "mp3"
            : asset.mimeType === "audio/mp4" ? "m4a"
              : asset.mimeType === "audio/wav" ? "wav"
                : undefined;
  if (!extension) throw productionArtifactError("素材格式不支持安全删除");
  return `inputs/${asset.id}.${extension}`;
}

/**
 * v4 字段的降级读取：损坏的分镜脚本被丢弃而不是让整个项目打不开——脚本可以重新生成，
 * 素材与成片不受影响。脚本丢弃后，挂在句子 id 上的配音记录也一并丢弃：没有脚本的
 * 音轨无法对回任何句子，保留只会让就绪检查报出无法解释的 mismatch。单条损坏的音轨
 * 同样只丢弃那一条，已成功的其余句子保持就绪，可单句重试补齐。
 */
function persistedStoryboardNarration(
  storyboard: unknown,
  narrationTracks: unknown,
  narrationAssets: unknown,
): { readonly storyboard?: ScriptStoryboard; readonly narrationTracks?: readonly TtsTimedTrack[]; readonly narrationAssets?: readonly PersistedNarrationAsset[] } {
  const parsedStoryboard = storyboard ? parseScriptStoryboard(storyboard) : undefined;
  if (!parsedStoryboard?.ok) return {};
  const sentenceIds = new Set(parsedStoryboard.value.sentences.map((sentence) => sentence.id));

  const tracks: TtsTimedTrack[] = [];
  const seenTracks = new Set<string>();
  for (const raw of Array.isArray(narrationTracks) ? narrationTracks : []) {
    const parsedTrack = parseTtsTimedTrack(raw);
    if (!parsedTrack.ok || !sentenceIds.has(parsedTrack.value.sentenceId) || seenTracks.has(parsedTrack.value.sentenceId)) continue;
    seenTracks.add(parsedTrack.value.sentenceId);
    tracks.push(parsedTrack.value);
  }

  const assets: PersistedNarrationAsset[] = [];
  const seenAssets = new Set<string>();
  for (const raw of Array.isArray(narrationAssets) ? narrationAssets : []) {
    const candidate = raw as Partial<PersistedNarrationAsset>;
    if (typeof candidate.sentenceId !== "string" || !candidate.sentenceId.trim()) continue;
    if (typeof candidate.audioPath !== "string" || !candidate.audioPath.trim()) continue;
    if (!sentenceIds.has(candidate.sentenceId) || seenAssets.has(candidate.sentenceId)) continue;
    seenAssets.add(candidate.sentenceId);
    assets.push({ sentenceId: candidate.sentenceId, audioPath: candidate.audioPath });
  }

  return {
    storyboard: parsedStoryboard.value,
    ...(tracks.length > 0 ? { narrationTracks: tracks } : {}),
    ...(assets.length > 0 ? { narrationAssets: assets } : {}),
  };
}

export function parseProject(value: string, projectId: string): PersistedProject | undefined {
  try {
    const parsed = JSON.parse(value) as PersistedProject;
    // v4 一句话成片允许空 analysisTaskId（参考拆解是可选增强，生成期读不到就跳过）；
    // 只有字段缺失或类型错误才把记录判为损坏。把空串当损坏会让新建项目一键管线必崩。
    if (parsed.projectId !== projectId || typeof parsed.analysisTaskId !== "string" || !parsed.brief || !Array.isArray(parsed.assets)) return undefined;
    if (!Number.isFinite(parsed.targetDurationSeconds) || !["draft", "planning", "ready", "rendering", "succeeded", "failed"].includes(parsed.status)) return undefined;
    const mode = parsed.mode ?? "montage";
    if (mode !== "montage" && mode !== "avatar") return undefined;
    const avatarScript = parsed.avatarScript?.trim();
    if (parsed.avatarScript !== undefined && !avatarScript) return undefined;
    const headlineText = parsed.headlineText?.trim();
    if (parsed.headlineText !== undefined && (!headlineText || headlineText.length > 24)) return undefined;
    const textPreset = parsed.textPreset ?? "classic_top";
    if (!(PRODUCTION_TEXT_PRESET_VALUES as readonly string[]).includes(textPreset)) return undefined;
    const assets = parsed.assets.map(persistedAsset);
    if (assets.some((asset) => !asset)) return undefined;
    // Two assets claiming the same requirement would make "the clip for item 3" ambiguous.
    const bound = assets.map((asset) => asset?.requirementOrder).filter((order) => order !== undefined);
    if (new Set(bound).size !== bound.length) return undefined;
    if (parsed.pendingRequirementOrder !== undefined && !isRequirementOrder(parsed.pendingRequirementOrder)) return undefined;
    const parsedPlan = parsed.plan ? productionPlanResultSchema.safeParse(parsed.plan) : undefined;
    const planUnreadable = Boolean(parsed.plan) && parsedPlan?.success !== true;
    const narration = persistedStoryboardNarration(parsed.storyboard, parsed.narrationTracks, parsed.narrationAssets);
    // 原始 v4 字段先剥掉再决定要不要放回校验后的版本：损坏值不能经 `...parsed` 漏回去。
    const { storyboard: _rawStoryboard, narrationTracks: _rawTracks, narrationAssets: _rawAssets, ...rest } = parsed;
    void _rawStoryboard; void _rawTracks; void _rawAssets;
    if (planUnreadable) {
      const { plan: _unreadablePlan, ...base } = rest;
      void _unreadablePlan;
      return {
        ...base,
        ...narration,
        mode,
        textPreset,
        ...(headlineText ? { headlineText } : {}),
        ...(avatarScript ? { avatarScript } : {}),
        assets: assets as readonly PersistedAsset[],
        status: "failed",
        issue: unreadablePlanIssue(),
      };
    }
    return {
      ...rest,
      ...narration,
      mode,
      textPreset,
      ...(headlineText ? { headlineText } : {}),
      ...(avatarScript ? { avatarScript } : {}),
      assets: assets as readonly PersistedAsset[],
      ...(parsedPlan?.success ? { plan: parsedPlan.data } : {}),
    };
  } catch {
    return undefined;
  }
}

export function toProductionProjectRecord(
  project: PersistedProject,
  toDisplayUri: (uri: string) => string,
): ProductionProjectRecord {
  const asset = (value: PersistedAsset): ProductionAsset => ({
    id: value.id,
    role: value.role ?? defaultAssetRole(value),
    uri: toDisplayUri(value.uri),
    kind: value.kind,
    origin: "imported",
    mimeType: value.mimeType,
    displayName: value.displayName,
    byteLength: value.sizeBytes,
    ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }),
    ...(value.requirementOrder === undefined ? {} : { requirementOrder: value.requirementOrder }),
    ...(value.insight?.usable === false && value.insight.unusableReason ? { reshootAdvice: value.insight.unusableReason } : {}),
  });
  return {
    projectId: project.projectId,
    analysisTaskId: project.analysisTaskId,
    brief: project.brief,
    mode: project.mode,
    textPreset: project.textPreset,
    ...(project.headlineText ? { headlineText: project.headlineText } : {}),
    ...(project.avatarScript ? { avatarScript: project.avatarScript } : {}),
    targetDurationSeconds: project.targetDurationSeconds,
    status: project.status,
    assets: project.assets.map(asset),
    ...(project.plan ? { plan: { schemaVersion: project.plan.schemaVersion, document: project.plan as unknown as JsonObject } } : {}),
    ...(project.output ? { output: { uri: toDisplayUri(project.output.uri), kind: "video", origin: "imported", mimeType: project.output.mimeType, byteLength: project.output.sizeBytes, durationSeconds: project.output.durationSeconds, displayName: "本地成片.mp4" } } : {}),
    ...(project.issue ? { issue: project.issue } : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
