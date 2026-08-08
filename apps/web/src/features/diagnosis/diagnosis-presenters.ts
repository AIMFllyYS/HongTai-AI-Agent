import type { DiagnosisReportRecord, JsonObject, JsonValue, ObservationMode } from "@hongtai/core";

type ImageQualityLevel = "good" | "limited" | "unusable";
type ObservationVisibility = "clear" | "limited" | "not_assessable";
type ReferenceCertainty = "possible" | "uncertain";
type RecommendationCategory = "daily_care" | "diet_lifestyle" | "monitoring";
type RecommendationPriority = "low" | "medium" | "high";
type SafetyLevel = "none" | "routine_attention" | "prompt_consultation" | "urgent";

export interface DiagnosisImageQualityView {
  readonly usable: boolean;
  readonly overallQuality: ImageQualityLevel;
  readonly limitations: readonly string[];
  readonly retakeSuggestions: readonly string[];
}

export interface DiagnosisObservationView {
  readonly id: string;
  readonly category: string;
  readonly region: string;
  readonly label: string;
  readonly description: string;
  readonly visibility: ObservationVisibility;
  readonly evidenceDescription: string;
}

export interface DiagnosisReferenceView {
  readonly title: string;
  readonly statement: string;
  readonly certainty: ReferenceCertainty;
  readonly basisObservationIds: readonly string[];
}

export interface DiagnosisRecommendationView {
  readonly category: RecommendationCategory;
  readonly priority: RecommendationPriority;
  readonly title: string;
  readonly action: string;
  readonly rationale: string;
  readonly relatedObservationIds: readonly string[];
}

export interface DiagnosisSafetyView {
  readonly level: SafetyLevel;
  readonly reasons: readonly string[];
  readonly recommendedAction: string;
}

export interface DiagnosisReportView {
  readonly available: boolean;
  readonly mode?: ObservationMode;
  readonly imageQuality?: DiagnosisImageQualityView;
  readonly summary?: { readonly headline: string; readonly keyPoints: readonly string[]; readonly narrative: string };
  readonly observations: readonly DiagnosisObservationView[];
  readonly wellnessReferences: readonly DiagnosisReferenceView[];
  readonly recommendations: readonly DiagnosisRecommendationView[];
  readonly safetyGuidance?: DiagnosisSafetyView;
  readonly followUpQuestions: readonly string[];
  readonly limitations: readonly string[];
  readonly disclaimer?: string;
}

const emptyReport: DiagnosisReportView = Object.freeze({
  available: false,
  observations: [],
  wellnessReferences: [],
  recommendations: [],
  followUpQuestions: [],
  limitations: [],
});

function isRecord(value: JsonValue | unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(stringValue);
  return result.every((item): item is string => Boolean(item)) ? result : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

function parseImageQuality(value: unknown): DiagnosisImageQualityView | undefined {
  if (!isRecord(value) || typeof value.usable !== "boolean") return undefined;
  const overallQuality = enumValue(value.overallQuality, ["good", "limited", "unusable"] as const);
  const limitations = stringList(value.limitations);
  const retakeSuggestions = stringList(value.retakeSuggestions);
  return overallQuality && limitations && retakeSuggestions
    ? { usable: value.usable, overallQuality, limitations, retakeSuggestions }
    : undefined;
}

function parseSummary(value: unknown): DiagnosisReportView["summary"] | undefined {
  if (!isRecord(value)) return undefined;
  const headline = stringValue(value.headline);
  const keyPoints = stringList(value.keyPoints);
  const narrative = stringValue(value.narrative);
  return headline && keyPoints && narrative ? { headline, keyPoints, narrative } : undefined;
}

function parseObservations(value: unknown): readonly DiagnosisObservationView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.map((item): DiagnosisObservationView | undefined => {
    if (!isRecord(item)) return undefined;
    const id = stringValue(item.id);
    const category = stringValue(item.category);
    const region = stringValue(item.region);
    const label = stringValue(item.label);
    const description = stringValue(item.description);
    const visibility = enumValue(item.visibility, ["clear", "limited", "not_assessable"] as const);
    const evidenceDescription = stringValue(item.evidenceDescription);
    return id && category && region && label && description && visibility && evidenceDescription
      ? { id, category, region, label, description, visibility, evidenceDescription }
      : undefined;
  });
  return records.every((item): item is DiagnosisObservationView => Boolean(item)) ? records : undefined;
}

function parseReferences(value: unknown, observationIds: ReadonlySet<string>): readonly DiagnosisReferenceView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.map((item): DiagnosisReferenceView | undefined => {
    if (!isRecord(item) || item.notADiagnosis !== true) return undefined;
    const title = stringValue(item.title);
    const statement = stringValue(item.statement);
    const certainty = enumValue(item.certainty, ["possible", "uncertain"] as const);
    const basisObservationIds = stringList(item.basisObservationIds);
    return title && statement && certainty && basisObservationIds && basisObservationIds.every((id) => observationIds.has(id))
      ? { title, statement, certainty, basisObservationIds }
      : undefined;
  });
  return records.every((item): item is DiagnosisReferenceView => Boolean(item)) ? records : undefined;
}

function parseRecommendations(value: unknown, observationIds: ReadonlySet<string>): readonly DiagnosisRecommendationView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.map((item): DiagnosisRecommendationView | undefined => {
    if (!isRecord(item)) return undefined;
    const category = enumValue(item.category, ["daily_care", "diet_lifestyle", "monitoring"] as const);
    const priority = enumValue(item.priority, ["low", "medium", "high"] as const);
    const title = stringValue(item.title);
    const action = stringValue(item.action);
    const rationale = stringValue(item.rationale);
    const relatedObservationIds = stringList(item.relatedObservationIds);
    return category && priority && title && action && rationale && relatedObservationIds && relatedObservationIds.every((id) => observationIds.has(id))
      ? { category, priority, title, action, rationale, relatedObservationIds }
      : undefined;
  });
  return records.every((item): item is DiagnosisRecommendationView => Boolean(item)) ? records : undefined;
}

function parseSafety(value: unknown): DiagnosisSafetyView | undefined {
  if (!isRecord(value)) return undefined;
  const level = enumValue(value.level, ["none", "routine_attention", "prompt_consultation", "urgent"] as const);
  const reasons = stringList(value.reasons);
  const recommendedAction = stringValue(value.recommendedAction);
  return level && reasons && recommendedAction ? { level, reasons, recommendedAction } : undefined;
}

/**
 * The presentation layer accepts only the formal report document. It does not
 * infer a score, symptom label, or hidden medical conclusion when any field is
 * absent or malformed.
 */
export function readDiagnosisReport(record: DiagnosisReportRecord): DiagnosisReportView {
  if (record.status !== "succeeded" || record.report?.schemaVersion !== "diagnosis-report.v1" || !isRecord(record.report.document)) {
    return emptyReport;
  }
  const document = record.report.document;
  const mode = enumValue(document.mode, ["tongue", "face"] as const);
  const imageQuality = parseImageQuality(document.imageQuality);
  const summary = parseSummary(document.summary);
  const observations = parseObservations(document.observations);
  if (!mode || !imageQuality || !summary || !observations) return emptyReport;
  const observationIds = new Set(observations.map((item) => item.id));
  if (observationIds.size !== observations.length) return emptyReport;
  const wellnessReferences = parseReferences(document.wellnessReferences, observationIds);
  const recommendations = parseRecommendations(document.recommendations, observationIds);
  const safetyGuidance = parseSafety(document.safetyGuidance);
  const followUpQuestions = stringList(document.followUpQuestions);
  const limitations = stringList(document.limitations);
  const disclaimer = stringValue(document.disclaimer);
  if (!wellnessReferences || !recommendations || !safetyGuidance || !followUpQuestions || !limitations || !disclaimer) return emptyReport;
  if ((!imageQuality.usable || imageQuality.overallQuality === "unusable") && observations.length > 0) return emptyReport;

  return {
    available: true,
    mode,
    imageQuality,
    summary,
    observations,
    wellnessReferences,
    recommendations,
    safetyGuidance,
    followUpQuestions,
    limitations,
    disclaimer,
  };
}

export function observationModeLabel(mode: ObservationMode): string {
  return mode === "tongue" ? "舌象观察" : "面部观察";
}

export function imageQualityLabel(value: ImageQualityLevel): string {
  if (value === "good") return "图像清晰";
  if (value === "limited") return "图像受限";
  return "图像不可用";
}

export function visibilityLabel(value: ObservationVisibility): string {
  if (value === "clear") return "清晰可见";
  if (value === "limited") return "可见度有限";
  return "暂无法观察";
}

export function safetyLabel(value: SafetyLevel): string {
  if (value === "none") return "日常留意";
  if (value === "routine_attention") return "建议关注";
  if (value === "prompt_consultation") return "建议尽快咨询专业人员";
  return "请及时寻求专业帮助";
}
