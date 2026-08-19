/**
 * Built-in decoration catalogue shared by the planner, the web preview and the Android overlay.
 *
 * Ids and public relative paths live here so the model, the preview `<img>` and the APK asset
 * lookup cannot drift. Placement insets match the renderer; they are a layout convention, not a
 * guarantee that a sticker will never cover a caption — the repository has no pixel collision check.
 */

import { SUBTITLE_REFERENCE_HEIGHT_PX, SUBTITLE_REFERENCE_WIDTH_PX } from "./subtitle-template";

export const DECORATION_CONTRACT_VERSION = "decoration-catalogue.v1";

/** Directory under the web public root and, after cap sync, under Android `assets/public/`. */
export const DECORATION_PUBLIC_DIR = "decorations";

export const DECORATION_IDS = [
  "arrow_right",
  "star_mark",
  "check_mark",
  "badge_one",
  "sparkle",
  "underline_brush",
  "speech_bubble",
] as const;

export type DecorationId = (typeof DECORATION_IDS)[number];

export const DECORATION_ANCHORS = ["top_left", "top_right", "middle_left", "middle_right", "above_caption"] as const;
export type DecorationAnchor = (typeof DECORATION_ANCHORS)[number];

export const DECORATION_ANIMATIONS = ["none", "fade", "pop", "float"] as const;
export type DecorationAnimation = (typeof DECORATION_ANIMATIONS)[number];

/** Authored raster size. The renderer draws the PNG at this pixel size, then applies `scale`. */
export const DECORATION_PIXEL_SIZE = 256;

/** Reject a catalogue PNG that is larger than this on either edge. */
export const DECORATION_MAX_EDGE_PX = 256;

/** Reject a catalogue PNG that exceeds this payload; keeps the APK garnish, not a sticker pack. */
export const DECORATION_MAX_BYTES = 48 * 1024;

/** Horizontal inset from the frame edge for left/right anchors, in reference pixels. */
export const DECORATION_INSET_PX = 48;

/** Distance from the frame top for `top_*` anchors, below the headline band. */
export const DECORATION_TOP_INSET_PX = 220;

/** Gap between `above_caption` and the caption's bottom offset. */
export const DECORATION_CAPTION_GAP_PX = 96;

/**
 * Width a decoration may occupy before its own scale is applied, as a share of the frame.
 * Small PNGs plus this cap are the only size control; they do not prove captions stay uncovered.
 */
export const DECORATION_MAX_WIDTH_SHARE = 0.5;

export interface DecorationItem {
  readonly id: DecorationId;
  /** Path relative to the web public root, without a leading slash: `decorations/{id}.png`. */
  readonly relativePath: string;
  readonly label: string;
  /** Short cues the planner uses to pick a sticker; not shown to the user. */
  readonly tags: readonly string[];
}

export function isDecorationId(value: unknown): value is DecorationId {
  return typeof value === "string" && (DECORATION_IDS as readonly string[]).includes(value);
}

export function decorationRelativePath(id: DecorationId): string {
  return `${DECORATION_PUBLIC_DIR}/${id}.png`;
}

/** Web static URL. Must stay in lockstep with `relativePath` or the preview is a different asset. */
export function decorationPublicUrl(id: DecorationId): string {
  return `/${decorationRelativePath(id)}`;
}

/**
 * AssetManager path after Capacitor copies `apps/web/dist` to `android/app/src/main/assets/public/`.
 * Missing files must fail the parse, not export a video with the sticker silently gone.
 */
export function decorationAssetManagerPath(id: DecorationId): string {
  return `public/${decorationRelativePath(id)}`;
}

export function decorationPreviewBox(input: {
  readonly anchor: DecorationAnchor;
  readonly scale: number;
  readonly captionBottomOffsetPx: number;
}): {
  readonly top?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly left?: string;
  readonly width: string;
  readonly transform: string;
  readonly transformOrigin: string;
} {
  const widthPct = (DECORATION_PIXEL_SIZE / SUBTITLE_REFERENCE_WIDTH_PX) * input.scale * 100;
  const insetX = `${(DECORATION_INSET_PX / SUBTITLE_REFERENCE_WIDTH_PX) * 100}%`;
  const top = `${(DECORATION_TOP_INSET_PX / SUBTITLE_REFERENCE_HEIGHT_PX) * 100}%`;
  const width = `${widthPct.toFixed(4)}%`;
  switch (input.anchor) {
    case "top_left":
      return { top, left: insetX, width, transform: "none", transformOrigin: "top left" };
    case "top_right":
      return { top, right: insetX, width, transform: "none", transformOrigin: "top right" };
    case "middle_left":
      return { top: "50%", left: insetX, width, transform: "translateY(-50%)", transformOrigin: "center left" };
    case "middle_right":
      return { top: "50%", right: insetX, width, transform: "translateY(-50%)", transformOrigin: "center right" };
    case "above_caption": {
      const bottomPx = input.captionBottomOffsetPx + DECORATION_CAPTION_GAP_PX;
      return {
        bottom: `${(bottomPx / SUBTITLE_REFERENCE_HEIGHT_PX) * 100}%`,
        left: "50%",
        width,
        transform: "translateX(-50%)",
        transformOrigin: "bottom center",
      };
    }
  }
}
