import {
  SUBTITLE_ALIGNMENTS,
  SUBTITLE_EASING_NAMES,
  SUBTITLE_EMPHASIS_KINDS,
  SUBTITLE_ENTRANCE_KINDS,
  SUBTITLE_PLATFORM_SAFE_BOTTOM_PX,
  SUBTITLE_REFERENCE_WIDTH_PX,
  SUBTITLE_TEMPLATE_IDS,
  SUBTITLE_WORD_REVEALS,
} from "@hongtai/core";
import { z } from "zod";

export const subtitleTemplateIdSchema = z.enum(SUBTITLE_TEMPLATE_IDS);

const subtitleColorSchema = z.object({
  hex: z.string().regex(/^#[0-9a-f]{6}$/u, "颜色必须是小写 #rrggbb"),
  opacity: z.number().min(0).max(1),
});

const subtitleStrokeSchema = z.object({
  color: subtitleColorSchema,
  widthPx: z.number().min(1).max(16),
});

const subtitleBoxSchema = z.object({
  color: subtitleColorSchema,
  paddingXPx: z.number().min(0).max(96),
  paddingYPx: z.number().min(0).max(64),
  radiusPx: z.number().min(0).max(64),
});

const subtitleEntranceSchema = z.object({
  kind: z.enum(SUBTITLE_ENTRANCE_KINDS),
  durationMs: z.number().min(0).max(600),
  easing: z.enum(SUBTITLE_EASING_NAMES),
  travelPx: z.number().min(0).max(80),
});

const subtitleEmphasisSchema = z.object({
  kind: z.enum(SUBTITLE_EMPHASIS_KINDS),
  color: subtitleColorSchema.nullable(),
  peakScale: z.number().min(1).max(1.6),
  durationMs: z.number().min(0).max(600),
  easing: z.enum(SUBTITLE_EASING_NAMES),
});

const subtitleTypographySchema = z.object({
  fontSizePx: z.number().min(28).max(72),
  lineHeight: z.number().min(1).max(2),
  fontWeight: z.number().int().min(400).max(900),
  letterSpacingPx: z.number().min(-2).max(6),
  maxLines: z.number().int().min(1).max(2),
  maxCharsPerLine: z.number().int().min(8).max(24),
});

const subtitleLayoutSchema = z.object({
  align: z.enum(SUBTITLE_ALIGNMENTS),
  bottomOffsetPx: z.number().min(SUBTITLE_PLATFORM_SAFE_BOTTOM_PX).max(900),
  insetPx: z.number().min(16).max(SUBTITLE_REFERENCE_WIDTH_PX / 3),
});

export const subtitleTemplateSchema = z.object({
  id: subtitleTemplateIdSchema,
  name: z.string().min(1).max(12),
  summary: z.string().min(1).max(60),
  typography: subtitleTypographySchema,
  layout: subtitleLayoutSchema,
  fill: subtitleColorSchema,
  stroke: subtitleStrokeSchema.nullable(),
  box: subtitleBoxSchema.nullable(),
  entrance: subtitleEntranceSchema,
  wordReveal: z.enum(SUBTITLE_WORD_REVEALS),
  pendingFill: subtitleColorSchema.nullable(),
  emphasis: subtitleEmphasisSchema,
  requiresWordTiming: z.boolean(),
  wordTimingFallbackId: subtitleTemplateIdSchema.nullable(),
}).superRefine((template, ctx) => {
  if (!template.stroke && !template.box) {
    ctx.addIssue({ code: "custom", message: "字幕必须有描边或底卡，否则在真实素材上读不清", path: ["stroke"] });
  }
  if (template.wordReveal === "karaoke") {
    if (!template.pendingFill) {
      ctx.addIssue({ code: "custom", message: "逐字点亮必须给出未读字的颜色", path: ["pendingFill"] });
    }
    if (!template.requiresWordTiming) {
      ctx.addIssue({ code: "custom", message: "逐字点亮必须声明依赖词级时间", path: ["requiresWordTiming"] });
    }
  }
  if (template.requiresWordTiming) {
    if (!template.wordTimingFallbackId) {
      ctx.addIssue({ code: "custom", message: "依赖词级时间的模板必须给出降级模板", path: ["wordTimingFallbackId"] });
    } else if (template.wordTimingFallbackId === template.id) {
      ctx.addIssue({ code: "custom", message: "降级模板不能是自己", path: ["wordTimingFallbackId"] });
    }
  }
  if (template.emphasis.kind === "none") {
    if (template.emphasis.peakScale !== 1 || template.emphasis.durationMs !== 0) {
      ctx.addIssue({ code: "custom", message: "没有强调时不应带缩放或动画时长", path: ["emphasis"] });
    }
  }
  if (template.emphasis.kind === "recolor" && !template.emphasis.color) {
    ctx.addIssue({ code: "custom", message: "变色强调必须给出强调颜色", path: ["emphasis", "color"] });
  }
  if ((template.emphasis.kind === "scale" || template.emphasis.kind === "bounce")
    && (template.emphasis.peakScale <= 1 || template.emphasis.durationMs <= 0)) {
    ctx.addIssue({ code: "custom", message: "缩放或弹跳强调必须给出大于 1 的峰值和大于 0 的时长", path: ["emphasis"] });
  }
  if (template.entrance.kind === "slide_up" && template.entrance.travelPx <= 0) {
    ctx.addIssue({ code: "custom", message: "上滑入场必须给出位移距离", path: ["entrance", "travelPx"] });
  }
});

export type SubtitleTemplateInput = z.input<typeof subtitleTemplateSchema>;
