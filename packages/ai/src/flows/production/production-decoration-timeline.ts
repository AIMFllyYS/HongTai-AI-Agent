import type { DecorationAnchor, DecorationAnimation, DecorationId } from "@hongtai/core";

import type { ProductionDecoration } from "../../schemas/production-plan-overlays";

export interface DecorationIntent {
  readonly kind: "sticker" | "floating_text";
  readonly assetRef: DecorationId | null;
  readonly text: string | null;
  readonly shotOrder: number;
  readonly anchor: DecorationAnchor;
  readonly scale: number;
  readonly animation: DecorationAnimation;
}

export interface DecorationCueWindow {
  readonly order: number;
  readonly cues: readonly { readonly startMs: number; readonly endMs: number }[];
}

/**
 * Lays each decoration onto a cue of its shot. Index 0 uses the first cue, index 1 the next, and
 * a shot with one cue reuses that window — density is enforced later, not by dropping extras here.
 */
export function deriveDecorationTimeline(
  intents: readonly DecorationIntent[],
  shots: readonly DecorationCueWindow[],
): ProductionDecoration[] {
  const cuesByShot = new Map(shots.map((shot) => [shot.order, shot.cues]));
  const usedOnShot = new Map<number, number>();
  return intents.map((intent) => {
    const cues = cuesByShot.get(intent.shotOrder);
    const cue = cues?.[Math.min(usedOnShot.get(intent.shotOrder) ?? 0, Math.max((cues?.length ?? 1) - 1, 0))];
    usedOnShot.set(intent.shotOrder, (usedOnShot.get(intent.shotOrder) ?? 0) + 1);
    return {
      kind: intent.kind,
      assetRef: intent.assetRef,
      text: intent.text,
      shotOrder: intent.shotOrder,
      startMs: cue?.startMs ?? 0,
      endMs: cue?.endMs ?? 1,
      anchor: intent.anchor,
      scale: intent.scale,
      animation: intent.animation,
    };
  });
}

export function stickerIntent(selection: {
  readonly shotOrder: number;
  readonly assetRef: DecorationId;
  readonly anchor: DecorationAnchor;
  readonly scale: number;
  readonly animation: DecorationAnimation;
}): DecorationIntent {
  return {
    kind: "sticker",
    assetRef: selection.assetRef,
    text: null,
    shotOrder: selection.shotOrder,
    anchor: selection.anchor,
    scale: selection.scale,
    animation: selection.animation,
  };
}

export function intentFromDecoration(decoration: ProductionDecoration): DecorationIntent {
  return {
    kind: decoration.kind,
    assetRef: decoration.assetRef,
    text: decoration.text,
    shotOrder: decoration.shotOrder,
    anchor: decoration.anchor,
    scale: decoration.scale,
    animation: decoration.animation,
  };
}
