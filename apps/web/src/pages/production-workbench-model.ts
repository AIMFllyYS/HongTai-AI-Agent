import type { IssueAction, ProductionAsset, ProductionMode, ProductionProjectRecord, ProductionStatus, ProductionTextPreset } from "@hongtai/core";

export const PRODUCTION_WORKBENCH_TABS = ["预览", "文案", "素材"] as const;
export type ProductionWorkbenchTab = (typeof PRODUCTION_WORKBENCH_TABS)[number];

export type ProductionWorkbenchStage =
  | "no-project"
  | "no-assets"
  | "no-plan"
  | "no-output"
  | "rendering"
  | "has-output"
  | "failed";

export const PRODUCTION_PRIMARY_LABELS = {
  "no-project": "一键制作视频",
  "no-assets": "添加素材",
  "no-plan": "AI 生成制作计划",
  "no-output": "开始本地合成",
  rendering: "正在本地合成",
  "has-output": "再做一条",
  failed: "重试",
} as const;

export const PRODUCTION_TEXT_PRESET_LABELS: Readonly<Record<ProductionTextPreset, string>> = {
  classic_top: "经典顶部白字",
  clean_card: "简洁白底卡片",
  aqua_accent: "青绿色强调",
};

export const PRODUCTION_RENDER_STAGE_COPY = {
  validate_avatar_audio: "正在校验数字人口播原声",
  synthesize_narration: "正在生成旁白",
  compile_shots: "正在编排镜头",
  export: "正在本地合成",
  saved: "成片已保存",
} as const;

export type ProductionRetryKind = "retry-operation" | "import" | "configure-ai" | "edit-input";
export type ProductionRetryOperation = "render" | "generate-plan" | "import";
export type ProductionPreviewKind = "output" | "image" | "video" | "empty";

export interface ProductionStageInput {
  readonly composingNew?: boolean;
  readonly project?: {
    readonly status: ProductionStatus;
    readonly assets: readonly unknown[];
    readonly plan?: unknown;
    readonly output?: unknown;
  };
}

export interface ProductionPrimaryAction {
  readonly stage: ProductionWorkbenchStage;
  readonly label: (typeof PRODUCTION_PRIMARY_LABELS)[ProductionWorkbenchStage];
  readonly disabled: boolean;
}

export function productionRenderStageCopy(stage: string): string {
  return Object.hasOwn(PRODUCTION_RENDER_STAGE_COPY, stage)
    ? PRODUCTION_RENDER_STAGE_COPY[stage as keyof typeof PRODUCTION_RENDER_STAGE_COPY]
    : "正在本地合成";
}

export function resolveProductionWorkbenchStage(input: ProductionStageInput): ProductionWorkbenchStage {
  if (!input.project || input.composingNew) return "no-project";
  if (input.project.status === "failed") return "failed";
  if (input.project.status === "rendering") return "rendering";
  if (input.project.output) return "has-output";
  if (input.project.plan) return "no-output";
  if (input.project.assets.length > 0) return "no-plan";
  return "no-assets";
}

export function resolveProductionPrimaryAction(input: ProductionStageInput & {
  readonly busy?: boolean;
  readonly planReady?: boolean;
  readonly importBlocked?: boolean;
}): ProductionPrimaryAction {
  const stage = resolveProductionWorkbenchStage(input);
  const disabled = Boolean(input.busy)
    || stage === "rendering"
    || (stage === "no-plan" && !input.planReady)
    || (stage === "no-assets" && Boolean(input.importBlocked));
  return { stage, label: PRODUCTION_PRIMARY_LABELS[stage], disabled };
}

export function resolveProductionRetryKind(action: IssueAction | undefined): ProductionRetryKind {
  if (action === "select_media") return "import";
  if (action === "configure_ai") return "configure-ai";
  if (action === "edit_input") return "edit-input";
  return "retry-operation";
}

export function resolveProductionRetryOperation(project: {
  readonly assets: readonly unknown[];
  readonly plan?: unknown;
}): ProductionRetryOperation {
  if (project.plan) return "render";
  if (project.assets.length > 0) return "generate-plan";
  return "import";
}

export function productionPlanReady(project: {
  readonly mode: ProductionMode;
  readonly assets: readonly Pick<ProductionAsset, "role" | "durationSeconds">[];
  readonly avatarScript?: string;
  readonly targetDurationSeconds: number;
}): boolean {
  const avatarMode = project.mode === "avatar";
  const requiredVisualAssets = avatarMode ? 1 : 3;
  const usableVisualAssets = project.assets.filter((asset) => avatarMode ? asset.role === "avatar" : asset.role === "visual").length;
  const avatarAsset = avatarMode ? project.assets.find((asset) => asset.role === "avatar") : undefined;
  const avatarDurationFits = !avatarMode || (avatarAsset?.durationSeconds !== undefined && avatarAsset.durationSeconds + 0.001 >= project.targetDurationSeconds);
  return usableVisualAssets >= requiredVisualAssets && avatarDurationFits && (!avatarMode || Boolean(project.avatarScript));
}

export function productionPreviewSource(project: {
  readonly output?: { readonly uri?: string };
  readonly assets: readonly { readonly kind: string; readonly uri: string }[];
}): { readonly kind: ProductionPreviewKind; readonly uri?: string } {
  if (project.output?.uri) return { kind: "output", uri: project.output.uri };
  const image = project.assets.find((asset) => asset.kind === "image");
  if (image) return { kind: "image", uri: image.uri };
  const video = project.assets.find((asset) => asset.kind === "video");
  if (video) return { kind: "video", uri: video.uri };
  return { kind: "empty" };
}

export function productionStatusLabel(status: ProductionProjectRecord["status"]): string {
  return ({ draft: "待准备", planning: "规划中", ready: "计划就绪", rendering: "合成中", succeeded: "已完成", failed: "未完成" } as const)[status];
}
