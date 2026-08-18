import {
  isSubtitleTemplateId,
  SUBTITLE_TEMPLATE_IDS,
  type ResolvedSubtitleTemplate,
  type SubtitleTemplate,
  type SubtitleTemplateId,
} from "./subtitle-template";

/**
 * The built-in subtitle templates. Colours reuse the product palette so previews and
 * burned-in captions stay on brand, while the stroke or box on every template keeps the
 * text readable over arbitrary footage.
 */
const CLASSIC_LINE: SubtitleTemplate = {
  id: "classic_line",
  name: "经典逐行",
  summary: "整句出现的白色描边字，任何素材上都稳，讲解和口播通用。",
  typography: { fontSizePx: 44, lineHeight: 1.32, fontWeight: 700, letterSpacingPx: 0.5, maxLines: 2, maxCharsPerLine: 14 },
  layout: { align: "center", bottomOffsetPx: 196, insetPx: 56 },
  fill: { hex: "#ffffff", opacity: 1 },
  stroke: { color: { hex: "#001512", opacity: 0.92 }, widthPx: 6 },
  box: null,
  entrance: { kind: "fade", durationMs: 160, easing: "standard", travelPx: 0 },
  wordReveal: "none",
  pendingFill: null,
  emphasis: { kind: "none", color: null, peakScale: 1, durationMs: 0, easing: "standard" },
  requiresWordTiming: false,
  wordTimingFallbackId: null,
};

const KARAOKE_GLOW: SubtitleTemplate = {
  id: "karaoke_glow",
  name: "逐字点亮",
  summary: "整句常驻，读到的字逐个点亮成青绿色，跟读感强，需要词级时间。",
  typography: { fontSizePx: 44, lineHeight: 1.32, fontWeight: 700, letterSpacingPx: 0.5, maxLines: 2, maxCharsPerLine: 13 },
  layout: { align: "center", bottomOffsetPx: 196, insetPx: 56 },
  fill: { hex: "#64f4da", opacity: 1 },
  stroke: { color: { hex: "#001512", opacity: 0.92 }, widthPx: 6 },
  box: null,
  entrance: { kind: "fade", durationMs: 140, easing: "standard", travelPx: 0 },
  wordReveal: "karaoke",
  pendingFill: { hex: "#ffffff", opacity: 0.62 },
  emphasis: { kind: "none", color: null, peakScale: 1, durationMs: 0, easing: "standard" },
  requiresWordTiming: true,
  wordTimingFallbackId: "classic_line",
};

const KEYWORD_POP: SubtitleTemplate = {
  id: "keyword_pop",
  name: "关键词高亮",
  summary: "整句白字，关键名词和数字换成亮黄色，信息密度高的讲解最稳妥。",
  typography: { fontSizePx: 44, lineHeight: 1.32, fontWeight: 700, letterSpacingPx: 0.5, maxLines: 2, maxCharsPerLine: 14 },
  layout: { align: "center", bottomOffsetPx: 196, insetPx: 56 },
  fill: { hex: "#ffffff", opacity: 1 },
  stroke: { color: { hex: "#001512", opacity: 0.92 }, widthPx: 6 },
  box: null,
  entrance: { kind: "slide_up", durationMs: 180, easing: "standard", travelPx: 14 },
  wordReveal: "none",
  pendingFill: null,
  emphasis: { kind: "recolor", color: { hex: "#ffe24d", opacity: 1 }, peakScale: 1, durationMs: 0, easing: "standard" },
  requiresWordTiming: false,
  wordTimingFallbackId: null,
};

const BOUNCE_ACCENT: SubtitleTemplate = {
  id: "bounce_accent",
  name: "情绪弹跳",
  summary: "句尾情绪词放大回弹，适合转折句和结尾引导，不宜整片密集使用。",
  typography: { fontSizePx: 46, lineHeight: 1.3, fontWeight: 800, letterSpacingPx: 0.5, maxLines: 2, maxCharsPerLine: 13 },
  layout: { align: "center", bottomOffsetPx: 200, insetPx: 56 },
  fill: { hex: "#ffffff", opacity: 1 },
  stroke: { color: { hex: "#001512", opacity: 0.92 }, widthPx: 7 },
  box: null,
  entrance: { kind: "pop", durationMs: 200, easing: "emphasized", travelPx: 0 },
  wordReveal: "none",
  pendingFill: null,
  emphasis: { kind: "bounce", color: { hex: "#64f4da", opacity: 1 }, peakScale: 1.3, durationMs: 250, easing: "overshoot" },
  requiresWordTiming: false,
  wordTimingFallbackId: null,
};

const VARIETY_CARD: SubtitleTemplate = {
  id: "variety_card",
  name: "综艺卡片",
  summary: "白色圆角卡片配深绿字，重点词转成暖橙，适合门店介绍和活动播报。",
  typography: { fontSizePx: 42, lineHeight: 1.36, fontWeight: 800, letterSpacingPx: 0.5, maxLines: 2, maxCharsPerLine: 12 },
  layout: { align: "center", bottomOffsetPx: 214, insetPx: 64 },
  fill: { hex: "#00342b", opacity: 1 },
  stroke: null,
  box: { color: { hex: "#ffffff", opacity: 0.94 }, paddingXPx: 30, paddingYPx: 18, radiusPx: 22 },
  entrance: { kind: "pop", durationMs: 220, easing: "emphasized", travelPx: 0 },
  wordReveal: "none",
  pendingFill: null,
  emphasis: { kind: "scale", color: { hex: "#b96100", opacity: 1 }, peakScale: 1.14, durationMs: 200, easing: "emphasized" },
  requiresWordTiming: false,
  wordTimingFallbackId: null,
};

const REGISTRY: Readonly<Record<SubtitleTemplateId, SubtitleTemplate>> = {
  classic_line: CLASSIC_LINE,
  karaoke_glow: KARAOKE_GLOW,
  keyword_pop: KEYWORD_POP,
  bounce_accent: BOUNCE_ACCENT,
  variety_card: VARIETY_CARD,
};

/** Ordered for pickers: the safest template first, the most decorated one last. */
export const SUBTITLE_TEMPLATES: readonly SubtitleTemplate[] = SUBTITLE_TEMPLATE_IDS.map((id) => REGISTRY[id]);

export const DEFAULT_SUBTITLE_TEMPLATE_ID: SubtitleTemplateId = "classic_line";

export function subtitleTemplateById(id: SubtitleTemplateId): SubtitleTemplate {
  return REGISTRY[id];
}

/**
 * Picks the template that is actually rendered. Templates that need word-level timing fall
 * back to their declared substitute when timing is unavailable, so a caption never claims a
 * per-word precision the audio pipeline could not produce.
 */
export function resolveSubtitleTemplate(input: {
  readonly id: string;
  readonly hasWordTiming?: boolean;
}): ResolvedSubtitleTemplate {
  const requestedId = isSubtitleTemplateId(input.id) ? input.id : DEFAULT_SUBTITLE_TEMPLATE_ID;
  const requested = REGISTRY[requestedId];
  if (!requested.requiresWordTiming || input.hasWordTiming !== false) return { template: requested };
  const fallbackId = requested.wordTimingFallbackId ?? DEFAULT_SUBTITLE_TEMPLATE_ID;
  return { template: REGISTRY[fallbackId], degradedFrom: requestedId };
}
