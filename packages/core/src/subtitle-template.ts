/**
 * Subtitle template contract shared by the web preview and the Android burn-in renderer.
 *
 * Every length is authored against the reference canvas below so one template describes
 * both a CSS preview and a burned-in overlay. TypeScript owns the styling decision;
 * the renderer only executes the parameters it receives.
 */
export const SUBTITLE_TEMPLATE_CONTRACT_VERSION = "subtitle-template.v1";

/** Reference canvas the template lengths are authored against. */
export const SUBTITLE_REFERENCE_WIDTH_PX = 720;
export const SUBTITLE_REFERENCE_HEIGHT_PX = 1280;

/** Vertical band reserved for platform chrome on vertical feeds; captions must clear it. */
export const SUBTITLE_PLATFORM_SAFE_BOTTOM_PX = 180;

export const SUBTITLE_TEMPLATE_IDS = [
  "classic_line",
  "karaoke_glow",
  "keyword_pop",
  "bounce_accent",
  "variety_card",
] as const;

export type SubtitleTemplateId = (typeof SUBTITLE_TEMPLATE_IDS)[number];

export const SUBTITLE_EASING_NAMES = ["linear", "standard", "emphasized", "overshoot"] as const;
export type SubtitleEasing = (typeof SUBTITLE_EASING_NAMES)[number];

/** Cubic-bezier control points; `standard` and `emphasized` match the shared motion tokens. */
export const SUBTITLE_EASING_CURVES: Readonly<Record<SubtitleEasing, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  standard: [0.2, 0, 0, 1],
  emphasized: [0.2, 0.8, 0.2, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
};

export const SUBTITLE_ENTRANCE_KINDS = ["none", "fade", "slide_up", "pop"] as const;
export type SubtitleEntranceKind = (typeof SUBTITLE_ENTRANCE_KINDS)[number];

export const SUBTITLE_WORD_REVEALS = ["none", "karaoke"] as const;
export type SubtitleWordReveal = (typeof SUBTITLE_WORD_REVEALS)[number];

export const SUBTITLE_EMPHASIS_KINDS = ["none", "recolor", "scale", "bounce"] as const;
export type SubtitleEmphasisKind = (typeof SUBTITLE_EMPHASIS_KINDS)[number];

export const SUBTITLE_ALIGNMENTS = ["left", "center"] as const;
export type SubtitleAlign = (typeof SUBTITLE_ALIGNMENTS)[number];

export interface SubtitleColor {
  /** Lowercase `#rrggbb`; alpha is carried separately so both platforms compose it the same way. */
  readonly hex: string;
  readonly opacity: number;
}

export interface SubtitleStroke {
  readonly color: SubtitleColor;
  readonly widthPx: number;
}

export interface SubtitleBox {
  readonly color: SubtitleColor;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly radiusPx: number;
}

export interface SubtitleEntrance {
  readonly kind: SubtitleEntranceKind;
  readonly durationMs: number;
  readonly easing: SubtitleEasing;
  /** Vertical travel used by `slide_up`; ignored by the other kinds. */
  readonly travelPx: number;
}

export interface SubtitleEmphasis {
  readonly kind: SubtitleEmphasisKind;
  /** Colour applied to emphasised words; null keeps the base fill. */
  readonly color: SubtitleColor | null;
  /** Font-size multiplier at the animation peak; 1 keeps the size unchanged. */
  readonly peakScale: number;
  readonly durationMs: number;
  readonly easing: SubtitleEasing;
}

export interface SubtitleTypography {
  readonly fontSizePx: number;
  /** Line box height as a multiplier of the font size. */
  readonly lineHeight: number;
  readonly fontWeight: number;
  readonly letterSpacingPx: number;
  readonly maxLines: number;
  readonly maxCharsPerLine: number;
}

export interface SubtitleLayout {
  readonly align: SubtitleAlign;
  /** Distance from the canvas bottom edge to the caption bottom. */
  readonly bottomOffsetPx: number;
  /** Horizontal inset applied to both sides. */
  readonly insetPx: number;
}

export interface SubtitleTemplate {
  readonly id: SubtitleTemplateId;
  readonly name: string;
  readonly summary: string;
  readonly typography: SubtitleTypography;
  readonly layout: SubtitleLayout;
  readonly fill: SubtitleColor;
  readonly stroke: SubtitleStroke | null;
  readonly box: SubtitleBox | null;
  readonly entrance: SubtitleEntrance;
  readonly wordReveal: SubtitleWordReveal;
  /** Colour of words not spoken yet; only meaningful when `wordReveal` is `karaoke`. */
  readonly pendingFill: SubtitleColor | null;
  readonly emphasis: SubtitleEmphasis;
  /** True when the designed look needs word-level timing to stay honest. */
  readonly requiresWordTiming: boolean;
  /** Template rendered instead when word-level timing is unavailable. */
  readonly wordTimingFallbackId: SubtitleTemplateId | null;
}

export function isSubtitleTemplateId(value: unknown): value is SubtitleTemplateId {
  return typeof value === "string" && (SUBTITLE_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function subtitleEasingCurve(easing: SubtitleEasing): readonly [number, number, number, number] {
  return SUBTITLE_EASING_CURVES[easing];
}

/** Captions must stay above the platform chrome band, otherwise the burned-in text is unreadable. */
export function subtitleClearsPlatformSafeArea(template: SubtitleTemplate): boolean {
  return template.layout.bottomOffsetPx >= SUBTITLE_PLATFORM_SAFE_BOTTOM_PX;
}

const LINE_BREAK_AFTER = new Set([
  "，", "。", "！", "？", "；", "：", "、", "…", "）", "」", "》",
  ",", ".", "!", "?", ";", ":", ")", " ",
]);

/**
 * Splits one caption into display lines using the rule both platforms implement:
 * fill greedily up to `maxCharsPerLine`, and prefer the last break opportunity in the
 * second half of the line so phrases stay intact. Lines are never truncated, so a caption
 * that needs more than `maxLines` returns every line and callers can reject it upstream.
 */
export function splitSubtitleLines(text: string, typography: SubtitleTypography): readonly string[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const limit = Math.max(1, Math.floor(typography.maxCharsPerLine));
  const characters = [...normalized];
  const lines: string[] = [];
  let index = 0;

  while (index < characters.length) {
    const remaining = characters.length - index;
    if (remaining <= limit) {
      lines.push(characters.slice(index).join(""));
      break;
    }
    const window = characters.slice(index, index + limit);
    let breakAt = -1;
    for (let position = window.length - 1; position >= Math.ceil(limit / 2); position -= 1) {
      const candidate = window[position];
      if (candidate !== undefined && LINE_BREAK_AFTER.has(candidate)) {
        breakAt = position + 1;
        break;
      }
    }
    const take = breakAt > 0 ? breakAt : limit;
    lines.push(window.slice(0, take).join("").trim());
    index += take;
  }

  return lines.filter((line) => line.length > 0);
}

/** True when the caption fits the template without overflowing its line budget. */
export function subtitleTextFits(text: string, typography: SubtitleTypography): boolean {
  return splitSubtitleLines(text, typography).length <= typography.maxLines;
}

export interface ResolvedSubtitleTemplate {
  readonly template: SubtitleTemplate;
  /** Set when the requested template was replaced because word-level timing is missing. */
  readonly degradedFrom?: SubtitleTemplateId;
}
