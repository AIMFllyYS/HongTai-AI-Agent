package com.hongtai.aiagent.production

/**
 * Decides which moments of an imported asset are worth showing a vision model, and how large the
 * derivative may be.
 *
 * Kept free of Android types so the choice of moments is unit-testable: `Bitmap` and
 * `MediaMetadataRetriever` are stubs on the JVM, and this is the part where a wrong answer means
 * describing a black fade-in instead of the shot.
 */
internal object ProductionInsightFramePolicy {
  /** Matches `MAX_INSIGHT_FRAMES` in `packages/ai/src/schemas/asset-insight.ts`. */
  const val MAX_FRAMES = 3

  /** The observation channel already proved this edge readable at an affordable size. */
  const val MAX_EDGE_PIXELS = 2_048
  const val JPEG_QUALITY = 90

  /**
   * The AI attachment channel refuses anything larger (`NativeAiRequestClient.MAX_ATTACHMENT_BYTES`).
   * A 2048px JPEG lands far below it, so hitting this means something went wrong and the frame must
   * be dropped rather than sent and rejected mid-request.
   */
  const val MAX_FRAME_BYTES = 15L * 1024L * 1024L

  /**
   * Moments to sample from a clip, in milliseconds.
   *
   * Never the first or last frame: openings fade in and endings cut to black, and a model shown
   * black frames will honestly report that it cannot see anything. Short clips get fewer samples
   * because three frames 300ms apart describe the same instant three times.
   */
  fun sampleMillis(durationMs: Long): List<Long> {
    if (durationMs <= 0L) return listOf(0L)
    val last = durationMs - 1L
    val fractions = when {
      durationMs < 1_500L -> listOf(0.5)
      durationMs < 4_000L -> listOf(0.25, 0.75)
      else -> listOf(0.10, 0.50, 0.85)
    }
    return fractions
      .map { fraction -> (durationMs * fraction).toLong().coerceIn(0L, maxOf(0L, last)) }
      .distinct()
  }

  /** Stable per-asset names so a re-run replaces its own derivatives instead of piling up. */
  fun frameFileName(assetId: String, index: Int): String = "$assetId-$index.jpg"

  /**
   * Matches the exact names this policy hands out. A prefix test would let `asset-1` claim
   * `asset-10-0.jpg` and delete another asset's frames; ids are opaque and nothing stops one from
   * being a prefix of another.
   */
  fun isFrameFileOf(assetId: String, fileName: String): Boolean =
    (0 until MAX_FRAMES).any { index -> fileName == frameFileName(assetId, index) }
}
