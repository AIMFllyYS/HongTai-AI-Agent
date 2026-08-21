import { productionPlanResultSchema, type ProductionPlanningAsset, type ProductionPlanResult } from "@hongtai/ai";
import {
  MAX_SHOTS_PER_PRODUCTION,
  PRODUCTION_TEXT_PRESET_VALUES,
  subtitleTemplateById,
  type ProductionAsset,
  type ProductionAssetRole,
  type ProductionMode,
  type ProductionProjectRecord,
  type ProductionTextPreset,
  type JsonObject,
  type TaskIssue,
  type TaskService,
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
  readonly output?: NativeProductionResult;
  readonly issue?: TaskIssue;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  if (plan.schemaVersion !== "production-plan.v3") return {};
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

export function parseProject(value: string, projectId: string): PersistedProject | undefined {
  try {
    const parsed = JSON.parse(value) as PersistedProject;
    if (parsed.projectId !== projectId || !parsed.analysisTaskId || !parsed.brief || !Array.isArray(parsed.assets)) return undefined;
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
    if (planUnreadable) {
      const { plan: _unreadablePlan, ...rest } = parsed;
      void _unreadablePlan;
      return {
        ...rest,
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
      ...parsed,
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
