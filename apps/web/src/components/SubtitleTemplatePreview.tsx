import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { resolveSubtitleTemplate, splitSubtitleLines, subtitleEasingCurve } from "@hongtai/core";

import { splitEmphasisSegments, subtitleCssColor, subtitleLineProgress, subtitleScale, subtitleStrokeShadow } from "../features/production/subtitle-preview-model";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";

const DEMO_CYCLE_MS = 3200;
const DEMO_SWEEP_SHARE = 0.78;

export interface SubtitleTemplatePreviewProps {
  readonly templateId: string;
  readonly text: string;
  readonly emphasisWords?: readonly string[];
  /** Spoken progress in 0-1. Omit to loop a demo sweep for template pickers. */
  readonly progress?: number;
  /** Pass false when word-level timing is unavailable so karaoke templates degrade honestly. */
  readonly hasWordTiming?: boolean;
  /**
   * `frame` overlays the caption at its real bottom offset inside a 9:16 stage.
   * `band` centres it in a short strip so a style swatch stays legible at picker width.
   */
  readonly placement?: "frame" | "band";
  readonly className?: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cubicBezier(easing: Parameters<typeof subtitleEasingCurve>[0]): string {
  return `cubic-bezier(${subtitleEasingCurve(easing).join(", ")})`;
}

/**
 * Renders one caption exactly as the subtitle template describes it, scaled from the reference
 * canvas onto the measured frame. The template contract is the only source of styling, so this
 * preview and the burned-in overlay stay in step.
 */
export function SubtitleTemplatePreview({ templateId, text, emphasisWords, progress, hasWordTiming, placement = "frame", className = "" }: SubtitleTemplatePreviewProps) {
  const [frameRef, frameWidth] = useMeasuredWidth<HTMLDivElement>();
  const resolved = useMemo(() => resolveSubtitleTemplate({ id: templateId, hasWordTiming }), [templateId, hasWordTiming]);
  const template = resolved.template;
  const karaoke = template.wordReveal === "karaoke";
  const [demoProgress, setDemoProgress] = useState(1);

  useEffect(() => {
    if (!karaoke || progress !== undefined) return undefined;
    if (prefersReducedMotion()) {
      setDemoProgress(1);
      return undefined;
    }
    let frame = 0;
    let origin = 0;
    const step = (now: number) => {
      if (origin === 0) origin = now;
      const phase = ((now - origin) % DEMO_CYCLE_MS) / DEMO_CYCLE_MS;
      setDemoProgress(Math.min(1, phase / DEMO_SWEEP_SHARE));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [karaoke, progress]);

  const scale = subtitleScale(frameWidth);
  const lines = useMemo(() => splitSubtitleLines(text, template.typography), [text, template.typography]);
  const spoken = progress ?? demoProgress;

  const frameStyle: CSSProperties = placement === "band"
    ? {
      paddingLeft: `${template.layout.insetPx * scale}px`,
      paddingRight: `${template.layout.insetPx * scale}px`,
      textAlign: template.layout.align,
    }
    : {
      bottom: `${template.layout.bottomOffsetPx * scale}px`,
      left: `${template.layout.insetPx * scale}px`,
      right: `${template.layout.insetPx * scale}px`,
      textAlign: template.layout.align,
    };

  const captionStyle: CSSProperties = {
    color: subtitleCssColor(template.pendingFill ?? template.fill),
    fontSize: `${template.typography.fontSizePx * scale}px`,
    fontWeight: template.typography.fontWeight,
    letterSpacing: `${template.typography.letterSpacingPx * scale}px`,
    lineHeight: template.typography.lineHeight,
    textShadow: subtitleStrokeShadow(template.stroke, scale),
    ...(template.box
      ? {
        backgroundColor: subtitleCssColor(template.box.color),
        borderRadius: `${template.box.radiusPx * scale}px`,
        padding: `${template.box.paddingYPx * scale}px ${template.box.paddingXPx * scale}px`,
      }
      : {}),
    ...(template.entrance.kind === "none"
      ? {}
      : {
        animationDuration: `${template.entrance.durationMs}ms`,
        animationTimingFunction: cubicBezier(template.entrance.easing),
      }),
    ...({
      "--subtitle-entrance-travel": `${template.entrance.travelPx * scale}px`,
      "--subtitle-emphasis-color": template.emphasis.color ? subtitleCssColor(template.emphasis.color) : subtitleCssColor(template.fill),
      "--subtitle-emphasis-peak": template.emphasis.peakScale,
      "--subtitle-emphasis-duration": `${template.emphasis.durationMs}ms`,
      "--subtitle-emphasis-easing": cubicBezier(template.emphasis.easing),
      "--subtitle-spoken-color": subtitleCssColor(template.fill),
    } as CSSProperties),
  };

  if (lines.length === 0) return null;

  return (
    <div
      className={`subtitle-preview subtitle-preview--${placement} ${className}`.trim()}
      data-degraded-from={resolved.degradedFrom ?? undefined}
      data-subtitle-template={template.id}
      ref={frameRef}
      style={frameStyle}
    >
      <span
        className="subtitle-preview__caption"
        data-emphasis={template.emphasis.kind}
        data-entrance={template.entrance.kind}
        key={`${template.id}:${text}`}
        style={captionStyle}
      >
        {lines.map((line, index) => (
          <span className="subtitle-preview__row" key={`${index}:${line}`}>
            <span className="subtitle-preview__line">
              <span className="subtitle-preview__text">{renderSegments(line, emphasisWords)}</span>
              {karaoke ? (
                <span
                  aria-hidden="true"
                  className="subtitle-preview__spoken"
                  style={{ clipPath: `inset(0 ${((1 - subtitleLineProgress(lines, index, spoken)) * 100).toFixed(2)}% 0 0)` }}
                >
                  {renderSegments(line, emphasisWords)}
                </span>
              ) : null}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

function renderSegments(line: string, emphasisWords: readonly string[] | undefined) {
  return splitEmphasisSegments(line, emphasisWords).map((segment, index) => (
    segment.emphasized
      ? <em className="subtitle-preview__emphasis" key={`${index}:${segment.text}`}>{segment.text}</em>
      : <span key={`${index}:${segment.text}`}>{segment.text}</span>
  ));
}
