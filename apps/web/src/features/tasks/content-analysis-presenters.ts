import type { ContentAnalysisRecord } from "@hongtai/core";

export interface ContentAnalysisView {
  readonly available: boolean;
  readonly overview?: {
    readonly summary: string;
    readonly theme: string;
    readonly targetAudiences: readonly string[];
    readonly communicationGoal?: string;
  };
  readonly hook?: {
    readonly type?: string;
    readonly description: string;
    readonly mechanism?: string;
    readonly evidenceRefs: readonly string[];
  };
  readonly painPoints: readonly AnalysisEvidenceItem[];
  readonly emotionalDrivers: readonly AnalysisEvidenceItem[];
  readonly structure: readonly AnalysisStructureItem[];
  readonly coreClaims: readonly AnalysisClaimItem[];
  readonly style?: {
    readonly tones: readonly string[];
    readonly pacing?: string;
    readonly languagePatterns: readonly string[];
    readonly interactionMechanisms: readonly string[];
  };
  readonly reusableTemplate?: {
    readonly formula: string;
    readonly steps: readonly string[];
    readonly variableSlots: readonly string[];
    readonly doNotCopy: readonly string[];
  };
  readonly risks: readonly AnalysisRiskItem[];
}

export interface AnalysisEvidenceItem {
  readonly description: string;
  readonly evidenceRefs: readonly string[];
}

export interface AnalysisStructureItem extends AnalysisEvidenceItem {
  readonly order: number;
  readonly summary: string;
  readonly role?: string;
  readonly techniques: readonly string[];
}

export interface AnalysisClaimItem {
  readonly claim: string;
  readonly supportLevel?: string;
  readonly evidenceRefs: readonly string[];
}

export interface AnalysisRiskItem extends AnalysisEvidenceItem {
  readonly category?: string;
  readonly level?: string;
  readonly suggestion?: string;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const string = asString(item);
    return string ? [string] : [];
  }) : [];
}

function asEvidenceItem(value: unknown): AnalysisEvidenceItem | undefined {
  const record = asRecord(value);
  const description = asString(record?.description);
  return description ? { description, evidenceRefs: asStringArray(record?.evidenceRefs) } : undefined;
}

function asStructureItem(value: unknown): AnalysisStructureItem | undefined {
  const record = asRecord(value);
  const order = record?.order;
  const summary = asString(record?.summary);
  if (!record || typeof order !== "number" || !Number.isInteger(order) || order < 1 || !summary) return undefined;
  const role = asString(record.role);
  return {
    order,
    description: summary,
    summary,
    ...(role === undefined ? {} : { role }),
    techniques: asStringArray(record.techniques),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asClaimItem(value: unknown): AnalysisClaimItem | undefined {
  const record = asRecord(value);
  const claim = asString(record?.claim);
  if (!record || !claim) return undefined;
  const supportLevel = asString(record.supportLevel);
  return {
    claim,
    ...(supportLevel === undefined ? {} : { supportLevel }),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asRiskItem(value: unknown): AnalysisRiskItem | undefined {
  const record = asRecord(value);
  const description = asString(record?.description);
  if (!record || !description) return undefined;
  const category = asString(record.category);
  const level = asString(record.level);
  const suggestion = asString(record.suggestion);
  return {
    description,
    ...(category === undefined ? {} : { category }),
    ...(level === undefined ? {} : { level }),
    ...(suggestion === undefined ? {} : { suggestion }),
    evidenceRefs: asStringArray(record.evidenceRefs),
  };
}

function asArray<T>(value: unknown, map: (item: unknown) => T | undefined): readonly T[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const mapped = map(item);
    return mapped === undefined ? [] : [mapped];
  }) : [];
}

/**
 * Reads a safe, display-only projection of the already validated analysis
 * document. Missing or malformed fields stay empty; they are never repaired in
 * the application interface layer.
 */
export function readContentAnalysis(record: ContentAnalysisRecord): ContentAnalysisView {
  if (record.status !== "succeeded" || record.result?.schemaVersion !== "content-analysis.v1") {
    return { available: false, painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [], risks: [] };
  }

  const document = asRecord(record.result.document);
  if (!document) return { available: false, painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [], risks: [] };

  const overviewRecord = asRecord(document.overview);
  const summary = asString(overviewRecord?.summary);
  const theme = asString(overviewRecord?.theme);
  const hookRecord = asRecord(document.hook);
  const hookDescription = asString(hookRecord?.description);
  const styleRecord = asRecord(document.style);
  const templateRecord = asRecord(document.reusableTemplate);

  return {
    available: true,
    overview: summary && theme ? {
      summary,
      theme,
      targetAudiences: asStringArray(overviewRecord?.targetAudiences),
      ...(asString(overviewRecord?.communicationGoal) === undefined
        ? {}
        : { communicationGoal: asString(overviewRecord?.communicationGoal) }),
    } : undefined,
    hook: hookDescription ? {
      description: hookDescription,
      evidenceRefs: asStringArray(hookRecord?.evidenceRefs),
      ...(asString(hookRecord?.type) === undefined ? {} : { type: asString(hookRecord?.type) }),
      ...(asString(hookRecord?.mechanism) === undefined ? {} : { mechanism: asString(hookRecord?.mechanism) }),
    } : undefined,
    painPoints: asArray(document.painPoints, asEvidenceItem),
    emotionalDrivers: asArray(document.emotionalDrivers, asEvidenceItem),
    structure: asArray(document.structure, asStructureItem),
    coreClaims: asArray(document.coreClaims, asClaimItem),
    style: styleRecord ? {
      tones: asStringArray(styleRecord.tones),
      pacing: asString(styleRecord.pacing),
      languagePatterns: asStringArray(styleRecord.languagePatterns),
      interactionMechanisms: asStringArray(styleRecord.interactionMechanisms),
    } : undefined,
    reusableTemplate: templateRecord && asString(templateRecord.formula) ? {
      formula: asString(templateRecord.formula)!,
      steps: asStringArray(templateRecord.steps),
      variableSlots: asStringArray(templateRecord.variableSlots),
      doNotCopy: asStringArray(templateRecord.doNotCopy),
    } : undefined,
    risks: asArray(document.risks, asRiskItem),
  };
}
