package com.hongtai.aiagent.production

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Turns a shot-relative timestamp into the caption state to draw. Kept free of Android drawing
 * types so the timing rules stay covered by JVM unit tests.
 */
internal data class SubtitleFrame(
  val cueIndex: Int,
  /** Eased 0..1 entrance progress; 1 once the entrance finished. */
  val entranceProgress: Float,
  /** Eased 0..1 karaoke sweep across the whole cue; 1 when the template has no word reveal. */
  val revealProgress: Float,
  /** Eased 0..1 emphasis progress; 1 when the emphasis is static. */
  val emphasisProgress: Float,
) {
  /** Characters of the caption already spoken, which is what the karaoke sweep repaints on. */
  fun revealedChars(totalChars: Int): Int =
    (revealProgress * totalChars).roundToInt().coerceIn(0, totalChars)

  /**
   * Identifies the pixels a frame needs, so consecutive frames that look identical reuse one
   * bitmap instead of re-encoding a texture. The entrance is replayed through overlay transforms
   * rather than repainted, so it stays out of the key.
   */
  fun bitmapKey(totalChars: Int): Long {
    val emphasisStep = (emphasisProgress.coerceIn(0f, 1f) * (EMPHASIS_STEPS - 1)).toLong()
    return (cueIndex.toLong() * MAX_CAPTION_CHARS + revealedChars(totalChars)) * EMPHASIS_STEPS + emphasisStep
  }

  private companion object {
    /** Upper bound on cue text length, matching the caption limit the parser enforces. */
    const val MAX_CAPTION_CHARS = 64L
    const val EMPHASIS_STEPS = 16L
  }
}

/**
 * Converts Media3 presentation times into shot-relative milliseconds.
 *
 * The first frame an overlay sees defines its zero, so the caption timing does not depend on how
 * Media3 offsets an item inside its sequence. [itemStartMs] carries the offset of this media item
 * within its shot, which is non-zero only when a short clip is repeated to fill the shot.
 */
internal class SubtitleOverlayClock(private val itemStartMs: Long) {
  private var baseUs: Long? = null

  fun relativeMs(presentationTimeUs: Long): Long {
    val base = baseUs ?: presentationTimeUs.also { baseUs = it }
    return itemStartMs + (presentationTimeUs - base) / 1_000L
  }
}

internal object SubtitleTimeline {
  private val CURVES = mapOf(
    "linear" to floatArrayOf(0f, 0f, 1f, 1f),
    "standard" to floatArrayOf(0.2f, 0f, 0f, 1f),
    "emphasized" to floatArrayOf(0.2f, 0.8f, 0.2f, 1f),
    "overshoot" to floatArrayOf(0.34f, 1.56f, 0.64f, 1f),
  )

  fun frameAt(cues: List<SubtitleCue>, template: SubtitleTemplateSpec, timeMs: Long): SubtitleFrame? {
    val cueIndex = cues.indexOfFirst { timeMs >= it.startMs && timeMs < it.endMs }
    if (cueIndex < 0) return null
    val cue = cues[cueIndex]
    val elapsedMs = timeMs - cue.startMs

    val entranceProgress = when {
      template.entrance.kind == "none" || template.entrance.durationMs <= 0L -> 1f
      else -> ease(template.entrance.easing, elapsedMs.toFloat() / template.entrance.durationMs)
    }
    val emphasisProgress = when {
      template.emphasis.kind != "bounce" || template.emphasis.durationMs <= 0L -> 1f
      else -> ease(template.emphasis.easing, elapsedMs.toFloat() / template.emphasis.durationMs)
    }
    val revealProgress = if (template.wordReveal == "karaoke") revealProgress(cue, timeMs) else 1f

    return SubtitleFrame(cueIndex, entranceProgress, revealProgress, emphasisProgress)
  }

  /**
   * Fraction of the cue text already spoken. Word timings drive the sweep by character count so
   * the highlight lands on the word being spoken instead of on a clock-proportional guess.
   */
  private fun revealProgress(cue: SubtitleCue, timeMs: Long): Float {
    val words = cue.words ?: return ((timeMs - cue.startMs).toFloat() / (cue.endMs - cue.startMs)).coerceIn(0f, 1f)
    val totalChars = words.sumOf { it.text.length }
    if (totalChars == 0) return 1f
    var spokenChars = 0f
    for (word in words) {
      when {
        timeMs >= word.endMs -> spokenChars += word.text.length
        timeMs > word.startMs -> {
          val within = (timeMs - word.startMs).toFloat() / (word.endMs - word.startMs)
          spokenChars += word.text.length * within.coerceIn(0f, 1f)
        }
        else -> return (spokenChars / totalChars).coerceIn(0f, 1f)
      }
    }
    return (spokenChars / totalChars).coerceIn(0f, 1f)
  }

  fun ease(name: String, progress: Float): Float {
    val clamped = progress.coerceIn(0f, 1f)
    val curve = CURVES[name] ?: return clamped
    if (clamped <= 0f || clamped >= 1f) return clamped
    return bezierValue(curve[1], curve[3], bezierParameter(curve[0], curve[2], clamped))
  }

  /** Newton-Raphson solve for the bezier parameter at a horizontal position. */
  private fun bezierParameter(x1: Float, x2: Float, x: Float): Float {
    var t = x
    repeat(6) {
      val error = bezierValue(x1, x2, t) - x
      if (abs(error) < 1e-4f) return t
      val slope = bezierSlope(x1, x2, t)
      if (abs(slope) < 1e-5f) return t
      t = (t - error / slope).coerceIn(0f, 1f)
    }
    return t
  }

  private fun bezierValue(c1: Float, c2: Float, t: Float): Float {
    val inverse = 1f - t
    return 3f * inverse * inverse * t * c1 + 3f * inverse * t * t * c2 + t * t * t
  }

  private fun bezierSlope(c1: Float, c2: Float, t: Float): Float {
    val inverse = 1f - t
    return 3f * inverse * inverse * c1 + 6f * inverse * t * (c2 - c1) + 3f * t * t * (1f - c2)
  }
}
