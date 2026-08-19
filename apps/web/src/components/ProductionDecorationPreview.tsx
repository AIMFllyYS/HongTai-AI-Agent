import type { CSSProperties } from "react";
import {
  decorationPreviewBox,
  decorationPublicUrl,
  isDecorationId,
  type DecorationAnchor,
} from "@hongtai/core";

import type { PlanDecorationView } from "../features/production/production-plan-view";

const ANCHORS = new Set<string>(["top_left", "top_right", "middle_left", "middle_right", "above_caption"]);

function asAnchor(value: string): DecorationAnchor | undefined {
  return ANCHORS.has(value) ? value as DecorationAnchor : undefined;
}

export interface ProductionDecorationPreviewProps {
  readonly decorations: readonly PlanDecorationView[];
  readonly captionBottomOffsetPx: number;
  readonly shotOrder?: number;
}

/**
 * Overlays catalogue PNGs using the same insets as the Android renderer. A missing catalogue id
 * is skipped rather than pointed at a made-up file, so the preview cannot show an asset the
 * export would refuse.
 */
export function ProductionDecorationPreview({
  decorations,
  captionBottomOffsetPx,
  shotOrder,
}: ProductionDecorationPreviewProps) {
  const visible = decorations.filter((item) => shotOrder === undefined || item.shotOrder === shotOrder);
  if (visible.length === 0) return null;

  return (
    <div aria-hidden="true" className="decoration-preview">
      {visible.map((item, index) => {
        const anchor = asAnchor(item.anchor);
        if (!anchor) return null;
        const box = decorationPreviewBox({ anchor, scale: item.scale, captionBottomOffsetPx });
        const style = {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          transform: box.transform,
          transformOrigin: box.transformOrigin,
        } as CSSProperties;
        if (item.kind === "sticker") {
          if (!item.assetRef || !isDecorationId(item.assetRef)) return null;
          return (
            <img
              alt=""
              className="decoration-preview__sticker"
              data-animation={item.animation}
              key={`${item.shotOrder}:${item.assetRef}:${index}`}
              src={decorationPublicUrl(item.assetRef)}
              style={style}
            />
          );
        }
        if (!item.text) return null;
        return (
          <span className="decoration-preview__text" data-animation={item.animation} key={`${item.shotOrder}:text:${index}`} style={style}>
            {item.text}
          </span>
        );
      })}
    </div>
  );
}
