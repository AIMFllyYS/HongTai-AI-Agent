import { MIN_MONTAGE_VISUAL_ASSETS, type ProductionAsset, type VersionedDocument } from "@hongtai/core";

export interface ReplicaRequirementView {
  readonly order: number;
  readonly role: string;
  readonly subject: string;
  readonly visualDescription: string;
  readonly materialKind: "image" | "video";
  readonly contentHint: string;
  readonly suggestedDurationSeconds: number;
  readonly scriptDraft: string;
  readonly evidenceCount: number;
}

export interface ReplicaBlueprintView {
  readonly usable: boolean;
  readonly premise: string;
  readonly suggestedTemplateId: string;
  readonly requirements: readonly ReplicaRequirementView[];
  /** Present only when the source genuinely could not produce a list. */
  readonly emptyReason: string;
  readonly totalSuggestedSeconds: number;
}

const EMPTY: ReplicaBlueprintView = {
  usable: false,
  premise: "",
  suggestedTemplateId: "",
  requirements: [],
  emptyReason: "",
  totalSuggestedSeconds: 0,
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  hook: "开场钩子",
  opening: "开场",
  context: "背景",
  proof: "证据",
  process: "过程",
  detail: "细节",
  contrast: "对比",
  result: "结果",
  closing: "收尾",
  cta: "行动号召",
};

export function requirementRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRequirement(value: unknown): ReplicaRequirementView | undefined {
  const record = asRecord(value);
  const material = asRecord(record?.material);
  const order = typeof record?.order === "number" && Number.isInteger(record.order) ? record.order : undefined;
  const visualDescription = asString(record?.visualDescription);
  const contentHint = asString(material?.contentHint);
  const scriptDraft = asString(record?.scriptDraft);
  const kind = material?.kind === "image" || material?.kind === "video" ? material.kind : undefined;
  const suggested = typeof material?.suggestedDurationSeconds === "number" && Number.isFinite(material.suggestedDurationSeconds)
    ? material.suggestedDurationSeconds : undefined;
  if (order === undefined || !visualDescription || !contentHint || !scriptDraft || !kind || suggested === undefined) return undefined;
  return {
    order,
    role: asString(record?.role) ?? "",
    subject: asString(record?.subject) ?? "",
    visualDescription,
    materialKind: kind,
    contentHint,
    suggestedDurationSeconds: suggested,
    scriptDraft,
    evidenceCount: Array.isArray(record?.evidenceRefs) ? record.evidenceRefs.length : 0,
  };
}

/**
 * Display-only projection of the blueprint the service already validated. The document crosses the
 * runtime boundary untyped and the interface layer cannot import the AI schema, so anything missing
 * stays empty here instead of being guessed at.
 */
export function readReplicaBlueprint(blueprint: VersionedDocument | undefined): ReplicaBlueprintView {
  if (!blueprint || blueprint.schemaVersion !== "replica-blueprint.v1") return EMPTY;
  const document = asRecord(blueprint.document);
  if (!document) return EMPTY;
  const requirements = Array.isArray(document.shots)
    ? document.shots.flatMap((shot) => { const mapped = asRequirement(shot); return mapped ? [mapped] : []; })
      .slice()
      .sort((left, right) => left.order - right.order)
    : [];
  return {
    usable: requirements.length > 0,
    premise: asString(document.premise) ?? "",
    suggestedTemplateId: asString(document.suggestedTemplateId) ?? "",
    requirements,
    emptyReason: asString(document.emptyReason) ?? "",
    totalSuggestedSeconds: requirements.reduce((sum, item) => sum + item.suggestedDurationSeconds, 0),
  };
}

export interface RequirementBinding {
  readonly requirement: ReplicaRequirementView;
  readonly asset?: ProductionAsset;
}

/**
 * Pairs each list item with the asset filmed for it. The binding is read off the assets rather than
 * kept alongside them in the screen, so a removed asset can never leave an item looking satisfied.
 */
export function requirementBindings(
  requirements: readonly ReplicaRequirementView[],
  assets: readonly ProductionAsset[],
): readonly RequirementBinding[] {
  const byOrder = new Map(assets.flatMap((asset) => (asset.requirementOrder === undefined ? [] : [[asset.requirementOrder, asset] as const])));
  return requirements.map((requirement) => {
    const asset = byOrder.get(requirement.order);
    return { requirement, ...(asset ? { asset } : {}) };
  });
}

/** Assets imported outside the checklist; they would become shots nobody planned for. */
export function unboundAssetCount(assets: readonly ProductionAsset[]): number {
  return assets.filter((asset) => asset.requirementOrder === undefined && asset.role === "visual").length;
}

export const MIN_BOUND_REQUIREMENTS = MIN_MONTAGE_VISUAL_ASSETS;

export interface WizardReadiness {
  readonly boundCount: number;
  readonly ready: boolean;
  /** Why the main action cannot run yet, in the user's terms. Empty when it can. */
  readonly blockedReason: string;
}

/**
 * The single place that decides whether the list is ready to become a video, so the button and its
 * explanation can never disagree.
 */
export function wizardReadiness(bindings: readonly RequirementBinding[]): WizardReadiness {
  const boundCount = bindings.filter((binding) => binding.asset !== undefined).length;
  if (boundCount < MIN_BOUND_REQUIREMENTS) {
    return {
      boundCount,
      ready: false,
      blockedReason: `还需要 ${MIN_BOUND_REQUIREMENTS - boundCount} 项素材：本地合成至少要 ${MIN_BOUND_REQUIREMENTS} 个画面才能剪成片。`,
    };
  }
  return { boundCount, ready: true, blockedReason: "" };
}

/**
 * What skipping an item actually does to the finished video. The total length is fixed when the
 * project opens, so a skipped item's seconds go to the shots that remain rather than shortening the
 * video — worth saying out loud before the user skips half the list.
 */
export function skipEffectHint(bindings: readonly RequirementBinding[], targetDurationSeconds: number): string {
  const bound = bindings.filter((binding) => binding.asset !== undefined).length;
  if (bound === 0 || bound === bindings.length) return "";
  const average = targetDurationSeconds / bound;
  return `跳过的 ${bindings.length - bound} 项不会缩短成片：${targetDurationSeconds} 秒会分给已绑定的 ${bound} 个镜头，平均每个约 ${average.toFixed(1)} 秒。`;
}
