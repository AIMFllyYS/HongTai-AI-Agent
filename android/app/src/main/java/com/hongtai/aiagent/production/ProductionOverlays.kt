package com.hongtai.aiagent.production

import android.graphics.Bitmap
import androidx.media3.common.OverlaySettings
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.StaticOverlaySettings

/**
 * Media3 overlays that burn a `subtitle-template.v1` caption and its decorations into a shot.
 *
 * Both overlays repaint only when the visible pixels change: Media3 uploads a new texture whenever
 * the returned bitmap's generation id moves, so returning the cached instance for an unchanged
 * frame keeps a 30 fps export from re-uploading the same caption hundreds of times.
 */
@UnstableApi
internal class ProductionCaptionOverlay(
  private val template: SubtitleTemplateSpec,
  private val cues: List<SubtitleCue>,
  private val frameWidth: Int,
  private val frameHeight: Int,
  itemStartMs: Long,
) : BitmapOverlay() {
  private val painter = SubtitleCaptionPainter(template)
  private val clock = SubtitleOverlayClock(itemStartMs)
  private val blank = painter.blank()
  private val maxWidthPx = SubtitleOverlayGeometry.captionMaxWidthPx(template, frameWidth)
  private var cachedKey: Long? = null
  private var cached: Bitmap = blank

  override fun getBitmap(presentationTimeUs: Long): Bitmap {
    val frame = frameAt(presentationTimeUs) ?: return blank
    val cue = cues[frame.cueIndex]
    val key = frame.bitmapKey(cue.text.length)
    if (key != cachedKey) {
      cached = painter.paint(cue, frame.revealedChars(cue.text.length), frame.emphasisProgress, maxWidthPx)
      cachedKey = key
    }
    return cached
  }

  override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
    val frame = frameAt(presentationTimeUs) ?: return HIDDEN
    return SubtitleOverlayGeometry
      .captionTransform(template, frameWidth, frameHeight, frame.entranceProgress)
      .toOverlaySettings()
  }

  private fun frameAt(presentationTimeUs: Long): SubtitleFrame? =
    SubtitleTimeline.frameAt(cues, template, clock.relativeMs(presentationTimeUs))
}

/**
 * Draws one bounded decoration. Floating text borrows the caption template's fill, stroke and box
 * so a decoration cannot introduce a look the chosen subtitle template did not define.
 */
@UnstableApi
internal class ProductionDecorationOverlay(
  private val decoration: ProductionDecorationSpec,
  private val template: SubtitleTemplateSpec,
  private val frameWidth: Int,
  private val frameHeight: Int,
  itemStartMs: Long,
) : BitmapOverlay() {
  private val painter = SubtitleCaptionPainter(template)
  private val clock = SubtitleOverlayClock(itemStartMs)
  private val blank = painter.blank()
  private val cue = SubtitleCue(
    startMs = decoration.startMs,
    endMs = decoration.endMs,
    text = requireNotNull(decoration.text) { "Only floating text decorations can be drawn yet." },
    emphasisWords = emptyList(),
    words = null,
  )
  private var cached: Bitmap? = null

  override fun getBitmap(presentationTimeUs: Long): Bitmap {
    if (progressAt(presentationTimeUs) == null) return blank
    return cached ?: painter
      .paint(cue, cue.text.length, 1f, SubtitleOverlayGeometry.decorationMaxWidthPx(decoration, frameWidth))
      .also { cached = it }
  }

  override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
    val progress = progressAt(presentationTimeUs) ?: return HIDDEN
    return SubtitleOverlayGeometry
      .decorationTransform(decoration, template.layout.bottomOffsetPx, frameWidth, frameHeight, progress)
      .toOverlaySettings()
  }

  private fun progressAt(presentationTimeUs: Long): Float? {
    val timeMs = clock.relativeMs(presentationTimeUs)
    if (timeMs < decoration.startMs || timeMs >= decoration.endMs) return null
    return (timeMs - decoration.startMs).toFloat() / (decoration.endMs - decoration.startMs)
  }
}

@UnstableApi
private val HIDDEN: OverlaySettings = StaticOverlaySettings.Builder().setAlphaScale(0f).build()

@UnstableApi
private fun SubtitleOverlayTransform.toOverlaySettings(): OverlaySettings =
  StaticOverlaySettings.Builder()
    .setAlphaScale(alphaScale)
    .setScale(scale, scale)
    .setBackgroundFrameAnchor(backgroundAnchorX, backgroundAnchorY)
    .setOverlayFrameAnchor(overlayAnchorX, overlayAnchorY)
    .build()
