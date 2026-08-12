package com.hongtai.aiagent.media.heif

internal object LegacyHeifDecodeLimits {
  const val MAX_SOURCE_BYTES = 15L * 1024L * 1024L
  const val MAX_SOURCE_EDGE = 8_192
  const val MAX_SOURCE_PIXELS = 16_777_216L
  const val MAX_OUTPUT_EDGE = 3_072
  const val MAX_OUTPUT_PIXELS = 9_437_184L
  const val MAX_RGBA_BYTES = 36L * 1024L * 1024L
}

internal enum class LegacyHeifNativeFailure(val code: Int) {
  INVALID(1),
  TOO_LARGE(2),
  UNAVAILABLE(3),
  ALLOCATION_FAILED(4),
  ;

  companion object {
    fun fromCode(code: Int): LegacyHeifNativeFailure = entries.firstOrNull { it.code == code } ?: UNAVAILABLE
  }
}

internal class LegacyHeifNativeException(
  val failureCode: Int,
) : Exception()
