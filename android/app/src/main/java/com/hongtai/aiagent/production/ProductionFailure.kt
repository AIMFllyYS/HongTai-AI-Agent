package com.hongtai.aiagent.production

/** Safe, stage-specific native failures mapped by the narrow Capacitor bridge. */
internal enum class ProductionFailureKind {
  MEDIA_SOURCE_INVALID,
  TTS_UNAVAILABLE,
  TTS_SYNTHESIS_FAILED,
  MEDIA_RENDER_TIMEOUT,
  MEDIA_EXPORT_FAILED,
  OUTPUT_FINALIZATION_FAILED,
}

internal class ProductionException(
  val kind: ProductionFailureKind,
  message: String,
  cause: Throwable? = null,
) : IllegalStateException(message, cause)
