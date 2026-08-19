import type { VersionedDocument } from "@hongtai/core";

export interface PlanCueView {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly emphasisWords: readonly string[];
  readonly hasWordTiming: boolean;
}

export interface PlanShotView {
  readonly order: number;
  readonly assetId: string;
  readonly durationSeconds: number;
  readonly narration: string;
  readonly caption: string;
  readonly cues: readonly PlanCueView[];
}

export interface PlanSubtitleView {
  /** What will actually burn in. */
  readonly templateId: string;
  /** What the user asked for when it was replaced for lack of word timing; otherwise the same id. */
  readonly requestedTemplateId: string;
  readonly degraded: boolean;
  readonly precision: string;
  readonly source: string;
}

export interface ProductionPlanView {
  /** False when there is no plan, or when it is too old for the tuning screen to edit. */
  readonly editable: boolean;
  readonly schemaVersion: string;
  readonly targetDurationSeconds: number;
  readonly shots: readonly PlanShotView[];
  readonly headlineText: string;
  readonly speechRate: number;
  readonly backgroundMusicAssetId: string | null;
  readonly backgroundMusicVolume: number;
  readonly subtitle?: PlanSubtitleView;
}

const EMPTY: ProductionPlanView = {
  editable: false,
  schemaVersion: "",
  targetDurationSeconds: 0,
  shots: [],
  headlineText: "",
  speechRate: 1,
  backgroundMusicAssetId: null,
  backgroundMusicVolume: 0,
};

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asCue(value: unknown): PlanCueView | undefined {
  const record = asRecord(value);
  const startMs = asFiniteNumber(record?.startMs);
  const endMs = asFiniteNumber(record?.endMs);
  const text = asString(record?.text);
  if (startMs === undefined || endMs === undefined || !text) return undefined;
  return {
    startMs,
    endMs,
    text,
    emphasisWords: Array.isArray(record?.emphasisWords)
      ? record.emphasisWords.flatMap((word) => { const value = asString(word); return value ? [value] : []; })
      : [],
    hasWordTiming: Array.isArray(record?.words) && record.words.length > 0,
  };
}

function asShot(value: unknown): PlanShotView | undefined {
  const record = asRecord(value);
  const order = asFiniteNumber(record?.order);
  const assetId = asString(record?.assetId);
  const durationSeconds = asFiniteNumber(record?.durationSeconds);
  const narration = asString(record?.narration);
  const caption = asString(record?.caption);
  if (order === undefined || !assetId || durationSeconds === undefined || !narration || !caption) return undefined;
  return {
    order,
    assetId,
    durationSeconds,
    narration,
    caption,
    cues: Array.isArray(record?.cues)
      ? record.cues.flatMap((cue) => { const mapped = asCue(cue); return mapped ? [mapped] : []; })
      : [],
  };
}

function asSubtitle(value: unknown): PlanSubtitleView | undefined {
  const record = asRecord(value);
  const templateId = asString(record?.templateId);
  if (!templateId) return undefined;
  const timing = asRecord(record?.timing);
  const degradedFrom = asString(record?.degradedFromTemplateId);
  return {
    templateId,
    requestedTemplateId: degradedFrom ?? templateId,
    degraded: degradedFrom !== undefined,
    precision: asString(timing?.precision) ?? "",
    source: asString(timing?.source) ?? "",
  };
}

/**
 * Reads a display-only projection of the plan the service already validated. The plan crosses the
 * runtime boundary as an untyped document and the interface layer cannot import the AI schema, so
 * missing or malformed fields stay empty here and are never repaired.
 *
 * `production-plan.v1` is reported as not editable because it carries no overlay or subtitle for
 * the service to rebuild, which is the same line `updatePlan` draws.
 */
export function readProductionPlan(plan: VersionedDocument | undefined): ProductionPlanView {
  if (!plan) return EMPTY;
  const document = asRecord(plan.document);
  if (!document) return { ...EMPTY, schemaVersion: plan.schemaVersion };

  const settings = asRecord(document.settings);
  const audio = asRecord(document.audio);
  const textOverlay = asRecord(document.textOverlay);
  const shots = Array.isArray(document.shots)
    ? document.shots.flatMap((shot) => { const mapped = asShot(shot); return mapped ? [mapped] : []; })
    : [];
  const subtitle = asSubtitle(document.subtitle);

  return {
    editable: plan.schemaVersion !== "production-plan.v1" && shots.length > 0,
    schemaVersion: plan.schemaVersion,
    targetDurationSeconds: asFiniteNumber(settings?.durationSeconds) ?? 0,
    shots,
    headlineText: asString(textOverlay?.primaryText) ?? "",
    speechRate: asFiniteNumber(audio?.speechRate) ?? 1,
    backgroundMusicAssetId: asString(audio?.backgroundMusicAssetId) ?? null,
    backgroundMusicVolume: asFiniteNumber(audio?.backgroundMusicVolume) ?? 0,
    ...(subtitle ? { subtitle } : {}),
  };
}
