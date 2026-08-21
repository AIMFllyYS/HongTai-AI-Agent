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

export function imageQualityBadgeLabel(value: ImageQualityLevel): string {
  if (value === "good") return "良好 · 可用";
  if (value === "limited") return "受限 · 部分可辨";
  return "不可用";
}

export function imageQualityDescription(quality: DiagnosisImageQualityView | undefined): string | undefined {
  if (!quality) return undefined;
  return quality.limitations[0];
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

export function safetyLevelChipLabel(value: SafetyLevel): string {
  if (value === "none") return "日常留意";
  if (value === "routine_attention") return "例行关注";
  if (value === "prompt_consultation") return "尽快咨询";
  return "及时求助";
}

export const OBSERVATION_REPORT_DISCLAIMER_FALLBACK = "本报告给出基于图片的初步判断，仅供日常参考和到医院正规核实，不是正式诊疗结论，不提供患病概率或健康评分，也不能替代专业检查。";

export function observationReportDisclaimer(report: DiagnosisReportView | undefined): string {
  return report?.disclaimer ?? OBSERVATION_REPORT_DISCLAIMER_FALLBACK;
}

export function firstNarrativeSentence(narrative: string | undefined): string | undefined {
  const trimmed = narrative?.trim();
  if (!trimmed) return undefined;
  const pause = trimmed.search(/[。！？!?]/u);
  return (pause >= 0 ? trimmed.slice(0, pause + 1) : trimmed).trim() || undefined;
}

export function observationReportHeroTitle(report: DiagnosisReportView): string {
  const label = report.observations[0]?.label.trim();
  if (label) return label;
  return firstNarrativeSentence(report.summary?.narrative) ?? report.summary?.headline ?? "观察报告";
}

export function observationCategoryLabel(category: string): string {
  if (category === "tongue_body") return "舌质";
  if (category === "tongue_coating") return "舌苔";
  if (category === "tongue_moisture") return "舌津";
  if (category === "tongue_shape") return "舌形";
  if (category === "facial_color") return "面色";
  if (category === "facial_skin") return "肤质";
  if (category === "localized_feature") return "局部";
  return category;
}

export function observationEvidenceText(item: DiagnosisObservationView): string | undefined {
  return item.evidenceDescription.trim() === item.description.trim() ? undefined : item.evidenceDescription;
}

export function observationBasisCaption(
  basisObservationIds: readonly string[],
  observations: readonly DiagnosisObservationView[],
): string | undefined {
  const indexes = basisObservationIds
    .map((id) => observations.findIndex((item) => item.id === id))
    .filter((index) => index >= 0)
    .map((index) => index + 1);
  if (indexes.length === 0) return undefined;
  return `依据：观察 ${indexes.join("、")}`;
}

export function referenceCertaintyLabel(certainty: ReferenceCertainty): string {
  return certainty === "possible" ? "推测 · 可能" : "推测 · 不确定";
}

export function recommendationPriorityLabel(priority: RecommendationPriority): string | undefined {
  if (priority === "high") return "优先";
  if (priority === "medium") return "建议安排";
  return undefined;
}

export function formatObservationTimestamp(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

export function observationReportMetaLine(input: {
  readonly mode: ObservationMode;
  readonly timestamp?: string;
  readonly now?: Date;
}): string {
  const time = formatObservationTimestamp(input.timestamp, input.now);
  return [time, observationModeLabel(input.mode), "本地保存"].filter((item): item is string => Boolean(item)).join(" · ");
}

export function observationReportStateLabel(
  status: "pending" | "running" | "succeeded" | "failed" | undefined,
  available: boolean,
): string {
  if (status === "succeeded" && available) return "已保存";
  if (status === "failed") return "未完成";
  if (status === "running") return "生成中";
  return "等待中";
}
