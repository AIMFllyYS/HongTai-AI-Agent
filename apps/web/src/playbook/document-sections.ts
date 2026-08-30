import type { IconName } from "./icon-catalog";

export interface DocumentSectionSpec {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
}

/** S4 拆解完成 · 竖屏 section headers. */
export const analysisDocumentSections: readonly DocumentSectionSpec[] = [
  { id: "overview", title: "概览", icon: "scan_search" },
  { id: "hook", title: "开场钩子", icon: "zap" },
  { id: "drivers", title: "痛点与情绪驱动", icon: "heart" },
  { id: "structure", title: "内容结构", icon: "list_ordered" },
  { id: "claims", title: "核心论点", icon: "quote" },
  { id: "style", title: "表达风格", icon: "pen_line" },
  { id: "template", title: "可复用模板", icon: "sparkles" },
  { id: "risks", title: "风险与边界", icon: "shield_alert" },
  { id: "evidence", title: "证据", icon: "file_text" },
];

/** S10 观察报告 section headers. */
export const observationReportSections = {
  summary: { title: "观察摘要", icon: "list_checks" },
  details: { title: "观察明细", icon: "eye" },
  references: { title: "日常参考", icon: "book_open" },
  recommendations: { title: "日常建议", icon: "lightbulb" },
  safety: { title: "安全提醒", icon: "shield_check" },
} as const satisfies Record<string, { readonly title: string; readonly icon: IconName }>;

/** S8 设置 rows. */
export const settingsRowGlyphs = {
  profile: "user",
  ai: "sparkles",
  alerts: "bell",
  scheme: "moon",
  theme: "palette",
  cache: "trash_2",
  about: "info",
  privacy: "shield",
  backgroundRun: "zap",
  battery: "shield_check",
} as const satisfies Record<string, IconName>;

export type ObservationRecommendationCategory = "daily_care" | "diet_lifestyle" | "monitoring";

export function observationRecommendationIcon(category: ObservationRecommendationCategory): IconName {
  if (category === "daily_care") return "camera";
  if (category === "diet_lifestyle") return "cup_soda";
  return "moon";
}
