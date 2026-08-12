import type {
  JsonObject,
  JsonValue,
  StructuredGenerationModuleId,
  StructuredGenerationModuleStatus,
  StructuredGenerationProgressV1,
  TaskIssue,
} from "@hongtai/core";

export interface ValidatedModuleFact {
  readonly label: string;
  readonly value: string;
}

export interface ValidatedModuleGroup {
  readonly title: string;
  readonly items: readonly string[];
}

export interface ValidatedModuleContent {
  readonly lead?: string;
  readonly facts?: readonly ValidatedModuleFact[];
  readonly groups?: readonly ValidatedModuleGroup[];
  readonly note?: string;
}

export interface ValidatedModuleDefinition {
  readonly moduleId: StructuredGenerationModuleId;
  readonly title: string;
  readonly runningLabel: string;
  readonly validatingLabel: string;
  readonly present: (result: JsonObject) => ValidatedModuleContent;
}

export interface ValidatedModuleRow {
  readonly moduleId: StructuredGenerationModuleId;
  readonly title: string;
  readonly status: StructuredGenerationModuleStatus;
  readonly statusLabel: string;
  readonly active: boolean;
  readonly showSkeleton: boolean;
  readonly content?: ValidatedModuleContent;
  readonly issue?: TaskIssue;
}

export function asObject(value: JsonValue | undefined): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

export function readObject(value: JsonObject | undefined, key: string): JsonObject | undefined {
  return asObject(value?.[key]);
}

export function readObjects(value: JsonObject | undefined, key: string): readonly JsonObject[] {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate.flatMap((item) => {
    const object = asObject(item);
    return object ? [object] : [];
  }) : [];
}

export function readString(value: JsonObject | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

export function readStrings(value: JsonObject | undefined, key: string): readonly string[] {
  const candidate = value?.[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

export function readNumber(value: JsonObject | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

export function nonEmpty(values: readonly (string | undefined)[]): readonly string[] {
  return values.filter((value): value is string => Boolean(value));
}

function statusLabel(
  definition: ValidatedModuleDefinition,
  status: StructuredGenerationModuleStatus,
  phase: StructuredGenerationProgressV1["phase"] | undefined,
  preparing: boolean,
  afterFailure: boolean,
): string {
  if (status === "succeeded") return "已完成并通过校验";
  if (status === "failed") return "本板块未完成";
  if (status === "repairing") return "正在校正本板块结构";
  if (status === "running") return phase === "validating" ? definition.validatingLabel : definition.runningLabel;
  if (afterFailure) return "未开始";
  if (preparing) return "正在准备生成资料";
  return "等待生成";
}

export function buildValidatedModuleRows(
  definitions: readonly ValidatedModuleDefinition[],
  progress?: StructuredGenerationProgressV1,
  issue?: TaskIssue,
): readonly ValidatedModuleRow[] {
  const modules = new Map(progress?.modules.map((module) => [module.moduleId, module]));
  const failedIndex = definitions.findIndex((definition) => modules.get(definition.moduleId)?.status === "failed");
  const preparing = progress === undefined || (
    progress.phase === "preparing" && !progress.modules.some((module) => module.status !== "pending")
  );

  return definitions.map((definition, index) => {
    const module = modules.get(definition.moduleId);
    const status = module?.status ?? "pending";
    const isPreparing = preparing && index === 0;
    const afterFailure = failedIndex >= 0 && index > failedIndex && status === "pending";
    const active = isPreparing || status === "running" || status === "repairing" || status === "failed";
    return {
      moduleId: definition.moduleId,
      title: definition.title,
      status,
      statusLabel: statusLabel(definition, status, progress?.phase, isPreparing, afterFailure),
      active,
      showSkeleton: isPreparing || status === "running" || status === "repairing",
      ...(status === "succeeded" && module?.result ? { content: definition.present(module.result) } : {}),
      ...(status === "failed" && issue ? { issue } : {}),
    };
  });
}
