import {
  MAX_PRODUCTION_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
  MIN_PRODUCTION_DURATION_SECONDS,
  type IssueAction,
  type MeasuredDurationViolation,
  type MeasuredDurationViolationReason,
  type ProductionProjectRecord,
  type ProductionService,
  type ProductionStatus,
  type ProductionTextPreset,
} from "@hongtai/core";
import type {
  MeasuredPlanComposeResult,
  ProductionNarrationRecord,
  ProductionScriptRecord,
  StandaloneProductionEvent,
} from "@hongtai/capacitor-runtime";

export const PRODUCTION_TEXT_PRESET_LABELS: Readonly<Record<ProductionTextPreset, string>> = {
  classic_top: "经典顶部白字",
  clean_card: "简洁白底卡片",
  aqua_accent: "青绿色强调",
};

export const PRODUCTION_RENDER_STAGE_COPY = {
  validate_avatar_audio: "正在校验口播切片原声",
  synthesize_narration: "正在生成旁白",
  compile_shots: "正在编排镜头",
  export: "正在本地合成",
  saved: "成片已保存",
} as const;

/**
 * v4（文稿先行）管线的运行期方法尚未进 core 的 `ProductionService` 契约，只在电容
 * 运行时的独立实现上。界面按这个收窄类型调用；DTO 与事件类型直接复用运行时包的
 * 版本化投影，不复制结构。
 */
export type ScriptProductionService = ProductionService & {
  generateScript(projectId: string, input?: { readonly brief?: string }): Promise<ProductionScriptRecord>;
  getScript(projectId: string): Promise<ProductionScriptRecord | undefined>;
  updateStoryboard(projectId: string, input: {
    readonly expectedUpdatedAt: string;
    readonly sentences: readonly {
      readonly sentenceId: string;
      readonly text?: string;
      readonly assetId?: string | null;
      readonly stickerId?: string | null;
    }[];
  }): Promise<ProductionScriptRecord>;
  synthesizeNarration(projectId: string, input?: {
    readonly sentenceIds?: readonly string[];
    readonly speechRate?: number;
  }): Promise<ProductionNarrationRecord>;
  getNarration(projectId: string): Promise<ProductionNarrationRecord | undefined>;
  composeMeasuredPlan(projectId: string, input?: { readonly subtitleTemplateId?: string }): Promise<MeasuredPlanComposeResult>;
  subscribe(projectId: string, listener: (event: StandaloneProductionEvent) => void | Promise<void>): () => void;
};

export function scriptProductionService(production: ProductionService): ScriptProductionService {
  const candidate = production as Partial<ScriptProductionService>;
  const missing = (["generateScript", "getScript", "updateStoryboard", "synthesizeNarration", "getNarration", "composeMeasuredPlan"] as const)
    .filter((method) => typeof candidate[method] !== "function");
  if (missing.length > 0) {
    throw new Error("当前运行时尚不支持分镜脚本管线");
  }
  return production as ScriptProductionService;
}

export type ProductionRetryKind = "retry-operation" | "import" | "configure-ai" | "edit-input";
export type ProductionRetryOperation = "render" | "generate-plan" | "import";
export type ProductionPreviewKind = "output" | "image" | "video" | "empty";

export function productionRenderStageCopy(stage: string): string {
  return Object.prototype.hasOwnProperty.call(PRODUCTION_RENDER_STAGE_COPY, stage)
    ? PRODUCTION_RENDER_STAGE_COPY[stage as keyof typeof PRODUCTION_RENDER_STAGE_COPY]
    : "正在本地合成";
}

export function resolveProductionRetryKind(action: IssueAction | undefined): ProductionRetryKind {
  if (action === "select_media") return "import";
  if (action === "configure_ai") return "configure-ai";
  if (action === "edit_input") return "edit-input";
  return "retry-operation";
}

/** v3 存量项目的重试映射：新项目走五阶段页，不会进入这里。 */
export function resolveProductionRetryOperation(project: {
  readonly assets: readonly unknown[];
  readonly plan?: unknown;
}): ProductionRetryOperation {
  if (project.plan) return "render";
  if (project.assets.length > 0) return "generate-plan";
  return "import";
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

// ============================ v4（文稿先行）五阶段会话 ============================

/**
 * 五阶段会话页的阶段模型（需求→分镜文稿→配音→合成→成片）。失败不是阶段：失败态走
 * `resolvePipelinePrimaryAction` 的 `failed` 上下文，页面按稳定 `TaskIssue.code` 与
 * `action` 决定具体重试入口，模型层只提供通用文案。
 */
export type ProductionPipelineStage = "requirement" | "script" | "narration" | "compose" | "output";

/** 五阶段的中文标签与一句话副说明；措辞保持诚实，不承诺未接通的能力。 */
export const PRODUCTION_PIPELINE_STAGE_LABELS: Readonly<Record<ProductionPipelineStage, { readonly title: string; readonly description: string }>> = {
  requirement: { title: "需求", description: "确认这次想讲的内容；创建项目后会自动生成分镜脚本。" },
  script: { title: "分镜文稿", description: "AI 按需求生成分镜脚本，确认文稿后才进入配音。" },
  narration: { title: "配音", description: "逐句合成配音，时长以实测为准。" },
  compose: { title: "合成", description: "按实测配音组装镜头，并在本机合成成片。" },
  output: { title: "成片", description: "渲染进度与成片回看都在这里，文件只保存在本机。" },
};

/** `resolveProductionPipelineStage` 的输入：项目记录里与管线推进有关的字段投影。 */
export interface ProductionPipelineStageInput {
  /** `generateScript` 调用进行中（含创建后的自动首次生成）；脚本落盘前只有页面知道。 */
  readonly scriptGenerating?: boolean;
  /**
   * v3 存量判据：项目带着 v3 时代生成的旧计划（`plan.schemaVersion` 非
   * `production-plan.v4`）且没有分镜脚本。v4 管线只会写 v4 计划，所以该组合只可能
   * 属于 v3 项目；缺省按 v4 处理（新项目与脚本生成失败的项目都从「分镜文稿」起步）。
   */
  readonly legacyPipeline?: boolean;
  /** 项目管线字段；无项目时会话入口停在「需求」。 */
  readonly project?: {
    readonly status: ProductionStatus;
    /** v4 分镜脚本；v3 存量项目没有该字段，存在即 v4 管线。 */
    readonly storyboard?: unknown;
    /** 逐句配音就绪态：已就绪句数与分镜总句数，来自配音记录的句级状态。 */
    readonly narration?: { readonly ready: number; readonly total: number };
  };
}

/**
 * 推导当前阶段（纯函数）：
 *
 * - `generateScript` 进行中 → `script`：脚本字段尚未落盘，只有页面的在飞标志可判。
 * - 无项目 → `requirement`。
 * - `rendering` / `succeeded` → `output`：沿用现有渲染/输出按钮语义。
 * - 无 `storyboard` 字段 → `legacyPipeline` 为真（v3 存量项目）时 `output`：直接呈现
 *   成片/渲染区，由页面另行标注旧版；否则是 v4 新项目或脚本生成失败的项目 → `script`，
 *   失败重试入口就在分镜文稿阶段。
 * - 有脚本但还没有任何一句配音 → `script`：等用户确认文稿。
 * - 部分句子就绪 → `narration`：逐句补齐。
 * - 全部就绪 → `compose`：是否已组装过 v4 计划不影响阶段，只影响主按钮文案。
 */
export function resolveProductionPipelineStage(input: ProductionPipelineStageInput): ProductionPipelineStage {
  if (input.scriptGenerating) return "script";
  const project = input.project;
  if (!project) return "requirement";
  if (project.status === "rendering" || project.status === "succeeded") return "output";
  if (!project.storyboard) return input.legacyPipeline ? "output" : "script";
  const ready = project.narration?.ready ?? 0;
  const total = project.narration?.total ?? 0;
  if (ready <= 0) return "script";
  if (ready < total) return "narration";
  return "compose";
}

/** 主按钮推导的上下文；全部来自页面已有状态，不读原始平台响应或私有路径。 */
export interface PipelinePrimaryActionContext {
  /** 分镜脚本是否已生成（script 阶段区分「生成」与「确认文稿」文案）。 */
  readonly storyboardReady?: boolean;
  /** v4 实测计划是否已组装（compose 阶段区分「开始合成」与「重新合成」）。 */
  readonly planComposed?: boolean;
  /** 是否正在渲染（output 阶段沿用「正在本地合成」的禁用语义）。 */
  readonly rendering?: boolean;
  /** 是否已有成片（output 阶段沿用「再做一条」语义）。 */
  readonly hasOutput?: boolean;
  /** 失败态：给通用「重试」；具体重试入口由页面按稳定 TaskIssue.code 与 action 决定。 */
  readonly failed?: boolean;
  /** 任一管线操作进行中（脚本生成、逐句配音、组装或渲染）；进行中禁用主按钮。 */
  readonly busy?: boolean;
}

export interface PipelinePrimaryAction {
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * 阶段主按钮文案：script 视脚本是否就绪、compose 视计划是否组装过、output 沿用现有
 * 渲染/输出按钮语义；失败态一律给通用「重试」，页面可按稳定问题码细化。
 */
export function resolvePipelinePrimaryAction(
  stage: ProductionPipelineStage,
  context: PipelinePrimaryActionContext = {},
): PipelinePrimaryAction {
  if (context.failed) return { label: "重试", disabled: Boolean(context.busy) };
  const busy = Boolean(context.busy);
  if (stage === "requirement") return { label: "创建制作项目", disabled: busy };
  if (stage === "script") {
    return { label: context.storyboardReady ? "确认文稿并生成配音" : "AI 生成分镜脚本", disabled: busy };
  }
  if (stage === "narration") return { label: "补齐配音", disabled: busy };
  if (stage === "compose") return { label: context.planComposed ? "重新合成" : "开始合成", disabled: busy };
  if (context.rendering) return { label: "正在本地合成", disabled: true };
  return { label: context.hasOutput ? "再做一条" : "开始本地合成", disabled: busy };
}

/** 配音实测时长的软边界种类；界面只按 kind 分支，不解析文案。 */
export type NarrationDurationAdvisoryKind = "total-too-short" | "total-too-long" | "sentence-too-long";

/** 一条软边界提示：kind 供分支，message 是给用户的诚实措辞（含实测秒数）。 */
export interface NarrationDurationAdvisoryItem {
  readonly kind: NarrationDurationAdvisoryKind;
  readonly message: string;
  /** 1-based 句序；仅 sentence-too-long 提供。 */
  readonly sentenceIndex?: number;
  /** 触发边界的实测毫秒：sentence-too-long 为该句时长，其余为总时长。 */
  readonly durationMs?: number;
}

export interface NarrationDurationAdvisory {
  readonly items: readonly NarrationDurationAdvisoryItem[];
  /** 存在任一软边界时为 true：继续合成前需要用户确认放行。 */
  readonly requiresAcknowledgement: boolean;
}

function advisorySeconds(durationMs: number): string {
  const seconds = durationMs / 1_000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * 配音实测时长的软边界提示：总时长不足或超出成片区间、单句超长都只提示（回改文稿或
 * 确认后继续），从不阻塞。边界值复用 core 的 production-bounds 常量，web 不复制数字。
 */
export function resolveNarrationDurationAdvisory(
  totalMs: number,
  sentenceDurations: readonly number[],
): NarrationDurationAdvisory {
  const items: NarrationDurationAdvisoryItem[] = [];
  if (totalMs > 0 && totalMs < MIN_PRODUCTION_DURATION_SECONDS * 1_000) {
    items.push({
      kind: "total-too-short",
      durationMs: totalMs,
      message: `实测配音总时长约 ${advisorySeconds(totalMs)} 秒，不足 ${MIN_PRODUCTION_DURATION_SECONDS} 秒，成片会偏短。`,
    });
  }
  if (totalMs > MAX_PRODUCTION_DURATION_SECONDS * 1_000) {
    items.push({
      kind: "total-too-long",
      durationMs: totalMs,
      message: `实测配音总时长约 ${advisorySeconds(totalMs)} 秒，超过 ${MAX_PRODUCTION_DURATION_SECONDS} 秒，建议精简文稿。`,
    });
  }
  for (const [index, durationMs] of sentenceDurations.entries()) {
    if (durationMs > MAX_SHOT_DURATION_SECONDS * 1_000) {
      items.push({
        kind: "sentence-too-long",
        sentenceIndex: index + 1,
        durationMs,
        message: `第 ${index + 1} 句实测约 ${advisorySeconds(durationMs)} 秒，超过单句 ${MAX_SHOT_DURATION_SECONDS} 秒，这句画面会停留偏久。`,
      });
    }
  }
  return { items, requiresAcknowledgement: items.length > 0 };
}

/** 合成阶段软违规（`MeasuredDurationViolation`）的界面投影：稳定 reason + 诚实文案。 */
export interface ComposeViolationItem {
  readonly reason: MeasuredDurationViolationReason;
  readonly message: string;
}

/**
 * 把运行时的软违规映射为界面条目：按稳定 `reason` 生成本地化文案（含实测秒数），
 * 界面按 reason 决定提示样式。空列表 = 没有需要确认放行的违规。
 */
export function composeViolationItems(violations: readonly MeasuredDurationViolation[]): readonly ComposeViolationItem[] {
  return violations.map((violation) => ({
    reason: violation.reason,
    message: measuredViolationMessage(violation),
  }));
}

function measuredViolationMessage(violation: MeasuredDurationViolation): string {
  if (violation.reason === "shot-too-long") {
    return `第 ${violation.shotIndex} 句实测约 ${advisorySeconds(violation.durationMs ?? 0)} 秒，超过单句 ${MAX_SHOT_DURATION_SECONDS} 秒，这句画面会停留偏久。`;
  }
  if (violation.reason === "total-too-short") {
    return `实测配音总时长约 ${advisorySeconds(violation.totalDurationMs ?? 0)} 秒，不足 ${MIN_PRODUCTION_DURATION_SECONDS} 秒，成片会偏短。`;
  }
  if (violation.reason === "total-too-long") {
    return `实测配音总时长约 ${advisorySeconds(violation.totalDurationMs ?? 0)} 秒，超过 ${MAX_PRODUCTION_DURATION_SECONDS} 秒，建议精简文稿。`;
  }
  return "实测时长提示";
}

/**
 * 配音软边界预告 → 合成软违规条目的词汇投影：还没组装过计划时，用配音实测时长提前
 * 给出同样的确认提示。单句超长在实测计划里对应单镜超长（v4 每镜即每句），reason 归一
 * 为 `shot-too-long`，界面只需要按一套 reason 分支。
 */
export function narrationAdvisoryToComposeItems(advisory: NarrationDurationAdvisory): readonly ComposeViolationItem[] {
  return advisory.items.map((item) => ({
    reason: item.kind === "sentence-too-long" ? "shot-too-long" : item.kind,
    message: item.message,
  }));
}
