package com.hongtai.aiagent.production

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import androidx.core.graphics.createBitmap
import kotlin.math.ceil
import kotlin.math.max

/**
 * Draws one caption frame described by a [SubtitleTemplateSpec]. The painter makes no styling
 * decision of its own: every colour, size and offset arrives from the template that TypeScript
 * authored, and the caption is drawn at the reference resolution the export profile already uses.
 */
internal class SubtitleCaptionPainter(private val template: SubtitleTemplateSpec) {
  private data class TextRun(val text: String, val argb: Int, val sizePx: Float)

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = weightedTypeface(template.typography.fontWeight)
    letterSpacing = template.typography.letterSpacingPx / template.typography.fontSizePx
    style = Paint.Style.FILL
  }
  private val strokePaint = Paint(fillPaint).apply {
    style = Paint.Style.STROKE
    strokeWidth = template.stroke?.widthPx ?: 0f
    strokeJoin = Paint.Join.ROUND
    color = template.stroke?.argb ?: 0
  }
  private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = template.box?.argb ?: 0 }

  /** Blank frame returned between cues; Media3 needs a bitmap even when nothing is visible. */
  fun blank(): Bitmap = createBitmap(1, 1)

  /**
   * @param maxWidthPx width the caption has to stay inside. A caption whose glyphs measure wider
   *   than the template's character budget assumed is shrunk to fit rather than clipped, because a
   *   caption cut off mid-word is worse than a slightly smaller one. Below [MIN_FIT_SCALE] the
   *   shrink would no longer be readable, so the render fails instead of shipping unreadable text.
   */
  fun paint(cue: SubtitleCue, revealedChars: Int, emphasisProgress: Float, maxWidthPx: Int): Bitmap {
    val lines = SubtitleTextLayout.splitLines(cue.text, template.typography.maxCharsPerLine)
    if (lines.isEmpty()) return blank()
    val natural = lines.mapIndexed { index, line -> runsFor(lines, index, line, cue, revealedChars, emphasisProgress) }
    val fitScale = fitScale(natural, maxWidthPx)
    val runsByLine = if (fitScale < 1f) natural.map { runs -> runs.map { it.copy(sizePx = it.sizePx * fitScale) } } else natural

    val fontSizePx = template.typography.fontSizePx * fitScale
    val metrics = fillPaint.also { it.textSize = fontSizePx }.fontMetrics
    val lineBoxPx = fontSizePx * template.typography.lineHeight
    val lineWidths = runsByLine.map { runs -> runs.sumOf { measure(it).toDouble() }.toFloat() }
    val contentWidth = lineWidths.maxOrNull() ?: 0f

    val growthPx = fontSizePx * (template.emphasis.peakScale - 1f)
    val padXPx = (template.box?.paddingXPx ?: 0f) * fitScale + strokePaint.strokeWidth + growthPx
    val padYPx = (template.box?.paddingYPx ?: 0f) * fitScale + strokePaint.strokeWidth + growthPx
    val width = ceil(contentWidth + padXPx * 2f).toInt().coerceAtLeast(1)
    val height = ceil(lineBoxPx * lines.size + padYPx * 2f).toInt().coerceAtLeast(1)

    val bitmap = createBitmap(width, height)
    val canvas = Canvas(bitmap)
    template.box?.let { box ->
      val inset = strokePaint.strokeWidth / 2f
      canvas.drawRoundRect(inset, inset, width - inset, height - inset, box.radiusPx, box.radiusPx, boxPaint)
    }

    runsByLine.forEachIndexed { index, runs ->
      val lineTop = padYPx + lineBoxPx * index
      val baseline = lineTop + (lineBoxPx - (metrics.descent - metrics.ascent)) / 2f - metrics.ascent
      val startX = when (template.layout.align) {
        "center" -> padXPx + (contentWidth - lineWidths[index]) / 2f
        else -> padXPx
      }
      if (template.stroke != null) drawRuns(canvas, runs, startX, baseline) { run -> strokePaint.also { it.textSize = run.sizePx } }
      drawRuns(canvas, runs, startX, baseline) { run -> fillPaint.also { it.textSize = run.sizePx; it.color = run.argb } }
    }
    return bitmap
  }

  private inline fun drawRuns(canvas: Canvas, runs: List<TextRun>, startX: Float, baseline: Float, paintFor: (TextRun) -> Paint) {
    var x = startX
    for (run in runs) {
      canvas.drawText(run.text, x, baseline, paintFor(run))
      x += measure(run)
    }
  }

  private fun measure(run: TextRun): Float {
    fillPaint.textSize = run.sizePx
    return fillPaint.measureText(run.text)
  }

  private fun fitScale(runsByLine: List<List<TextRun>>, maxWidthPx: Int): Float {
    val boxPaddingPx = (template.box?.paddingXPx ?: 0f) * 2f
    val available = maxWidthPx - strokePaint.strokeWidth * 2f - boxPaddingPx
    val widest = runsByLine.maxOfOrNull { runs -> runs.sumOf { measure(it).toDouble() } }?.toFloat() ?: 0f
    if (widest <= 0f || widest <= available) return 1f
    val scale = available / widest
    check(scale >= MIN_FIT_SCALE) { "A subtitle caption is too wide for the export frame." }
    return scale
  }

  /**
   * Splits one display line into runs that share a colour and size. Emphasis comes from the cue's
   * keyword list; the karaoke boundary is a second cut so a word can be half spoken.
   */
  private fun runsFor(
    lines: List<String>,
    index: Int,
    line: String,
    cue: SubtitleCue,
    revealedChars: Int,
    emphasisProgress: Float,
  ): List<TextRun> {
    val emphasisArgb = if (template.emphasis.kind == "none") template.fillArgb else template.emphasis.argb ?: template.fillArgb
    val emphasisSizePx = when (template.emphasis.kind) {
      "scale" -> template.typography.fontSizePx * template.emphasis.peakScale
      "bounce" -> template.typography.fontSizePx * (1f + (template.emphasis.peakScale - 1f) * bounce(emphasisProgress))
      else -> template.typography.fontSizePx
    }
    val revealedInLine = if (template.wordReveal == "karaoke") {
      val before = lines.take(index).sumOf { it.length }
      (revealedChars - before).coerceIn(0, line.length)
    } else {
      line.length
    }

    val runs = mutableListOf<TextRun>()
    var consumed = 0
    for (segment in SubtitleTextLayout.splitEmphasis(line, cue.emphasisWords)) {
      val argb = if (segment.emphasized) emphasisArgb else template.fillArgb
      val sizePx = if (segment.emphasized) emphasisSizePx else template.typography.fontSizePx
      val spokenInSegment = (revealedInLine - consumed).coerceIn(0, segment.text.length)
      when {
        template.pendingArgb == null || spokenInSegment == segment.text.length -> runs += TextRun(segment.text, argb, sizePx)
        spokenInSegment == 0 -> runs += TextRun(segment.text, template.pendingArgb, sizePx)
        else -> {
          runs += TextRun(segment.text.substring(0, spokenInSegment), argb, sizePx)
          runs += TextRun(segment.text.substring(spokenInSegment), template.pendingArgb, sizePx)
        }
      }
      consumed += segment.text.length
    }
    return runs
  }

  /**
   * Rises to the peak then settles back, so a bounce reads as a beat rather than a size change.
   * The peak sits at 45% of the animation to match the web preview keyframes.
   */
  private fun bounce(progress: Float): Float {
    val clamped = progress.coerceIn(0f, 1f)
    return if (clamped <= BOUNCE_PEAK) clamped / BOUNCE_PEAK else max(0f, (1f - clamped) / (1f - BOUNCE_PEAK))
  }

  private fun weightedTypeface(weight: Int): Typeface = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> Typeface.create(Typeface.DEFAULT, weight, false)
    weight >= 600 -> Typeface.DEFAULT_BOLD
    else -> Typeface.DEFAULT
  }

  private companion object {
    const val BOUNCE_PEAK = 0.45f
    const val MIN_FIT_SCALE = 0.7f
  }
}
