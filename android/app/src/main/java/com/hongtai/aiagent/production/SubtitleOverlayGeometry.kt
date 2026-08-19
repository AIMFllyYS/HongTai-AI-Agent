package com.hongtai.aiagent.production

/**
 * Placement and entrance maths for burned-in overlays, expressed in the normalised device
 * coordinates Media3 anchors use: x runs -1 (left) to 1 (right) and y runs -1 (bottom) to 1 (top).
 *
 * Kept apart from the Media3 and Canvas types so the placement rules stay unit tested. The
 * entrance curves mirror the web preview keyframes, so a template previewed in the app and the
 * same template burned into the export animate the same way.
 */
internal data class SubtitleOverlayTransform(
  val alphaScale: Float,
  val scale: Float,
  val backgroundAnchorX: Float,
  val backgroundAnchorY: Float,
  val overlayAnchorX: Float,
  val overlayAnchorY: Float,
)

internal object SubtitleOverlayGeometry {
  /** Starting scale of the `pop` entrance, matching `@keyframes subtitle-entrance-pop`. */
  private const val POP_START_SCALE = 0.86f

  fun captionTransform(
    template: SubtitleTemplateSpec,
    frameWidth: Int,
    frameHeight: Int,
    entranceProgress: Float,
  ): SubtitleOverlayTransform {
    val progress = entranceProgress.coerceIn(0f, 1f)
    val settled = template.entrance.kind == "none"
    val travelPx = if (template.entrance.kind == "slide_up") template.entrance.travelPx * (1f - progress) else 0f
    return SubtitleOverlayTransform(
      alphaScale = if (settled) 1f else progress,
      scale = if (template.entrance.kind == "pop") POP_START_SCALE + (1f - POP_START_SCALE) * progress else 1f,
      backgroundAnchorX = when (template.layout.align) {
        "center" -> 0f
        else -> fromLeft(template.layout.insetPx, frameWidth)
      },
      backgroundAnchorY = fromBottom(template.layout.bottomOffsetPx - travelPx, frameHeight),
      overlayAnchorX = if (template.layout.align == "center") 0f else -1f,
      overlayAnchorY = -1f,
    )
  }

  /** Width a caption may occupy: a centred caption uses the frame, an inset one starts past it. */
  fun captionMaxWidthPx(template: SubtitleTemplateSpec, frameWidth: Int): Int =
    if (template.layout.align == "center") frameWidth else (frameWidth - template.layout.insetPx).toInt()

  /**
   * Width a decoration may occupy before its own scale is applied, so a decoration stays a garnish
   * next to the caption instead of covering the frame.
   */
  fun decorationMaxWidthPx(decoration: ProductionDecorationSpec, frameWidth: Int): Int =
    (frameWidth * DECORATION_MAX_WIDTH_SHARE / decoration.scale).toInt()

  fun decorationTransform(
    decoration: ProductionDecorationSpec,
    captionBottomOffsetPx: Float,
    frameWidth: Int,
    frameHeight: Int,
    progress: Float,
  ): SubtitleOverlayTransform {
    val eased = progress.coerceIn(0f, 1f)
    val onRight = decoration.anchor.endsWith("_right")
    val anchorX = when {
      decoration.anchor == "above_caption" -> 0f
      onRight -> -fromLeft(DECORATION_INSET_PX, frameWidth)
      else -> fromLeft(DECORATION_INSET_PX, frameWidth)
    }
    val anchorY = when (decoration.anchor) {
      "top_left", "top_right" -> -fromBottom(DECORATION_TOP_INSET_PX, frameHeight)
      "above_caption" -> fromBottom(captionBottomOffsetPx + DECORATION_CAPTION_GAP_PX, frameHeight)
      else -> 0f
    }
    val floatPx = if (decoration.animation == "float") DECORATION_FLOAT_PX * kotlin.math.sin(eased * 2f * Math.PI).toFloat() else 0f
    return SubtitleOverlayTransform(
      alphaScale = if (decoration.animation == "none") 1f else fadeIn(eased, decoration.animation),
      scale = decoration.scale * if (decoration.animation == "pop") POP_START_SCALE + (1f - POP_START_SCALE) * popIn(eased) else 1f,
      backgroundAnchorX = anchorX,
      backgroundAnchorY = (anchorY + 2f * floatPx / frameHeight).coerceIn(-1f, 1f),
      overlayAnchorX = if (decoration.anchor == "above_caption") 0f else if (onRight) 1f else -1f,
      overlayAnchorY = when (decoration.anchor) {
        "top_left", "top_right" -> 1f
        "above_caption" -> -1f
        else -> 0f
      },
    )
  }

  /** Decoration entrances run over a fixed lead-in so a short sticker still animates in. */
  private fun fadeIn(progress: Float, animation: String): Float =
    if (animation == "float") 1f else (progress / DECORATION_LEAD_IN).coerceIn(0f, 1f)

  private fun popIn(progress: Float): Float =
    SubtitleTimeline.ease("overshoot", (progress / DECORATION_LEAD_IN).coerceIn(0f, 1f))

  private fun fromLeft(insetPx: Float, frameWidth: Int): Float =
    (-1f + 2f * insetPx / frameWidth).coerceIn(-1f, 1f)

  private fun fromBottom(offsetPx: Float, frameHeight: Int): Float =
    (-1f + 2f * offsetPx / frameHeight).coerceIn(-1f, 1f)

  /**
   * Insets must stay equal to `packages/core/src/decoration.ts`. There is no pixel collision check
   * against captions; these slots only keep stickers off the headline and caption bands by layout.
   */
  private const val DECORATION_INSET_PX = 48f
  private const val DECORATION_TOP_INSET_PX = 220f
  private const val DECORATION_CAPTION_GAP_PX = 96f
  private const val DECORATION_FLOAT_PX = 14f
  private const val DECORATION_MAX_WIDTH_SHARE = 0.5f
  /** Fraction of a decoration's life spent animating in. */
  private const val DECORATION_LEAD_IN = 0.18f
}
