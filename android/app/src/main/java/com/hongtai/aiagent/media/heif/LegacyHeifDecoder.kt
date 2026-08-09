package com.hongtai.aiagent.media.heif

import android.graphics.Bitmap
import com.hongtai.aiagent.media.DecodedObservationImage
import com.hongtai.aiagent.media.LegacyHeifDecodeException
import com.hongtai.aiagent.media.LegacyHeifFailure
import com.hongtai.aiagent.media.ObservationImageDecoder
import java.io.File

/** Loads the decoder-only native fallback only after the API 24/25 selector chooses it. */
internal object LegacyHeifDecoder : ObservationImageDecoder<Bitmap> {
  @Volatile
  private var librariesLoaded = false

  override fun decode(source: File): DecodedObservationImage<Bitmap> {
    val sourceBytes = source.length()
    if (!source.isFile || sourceBytes <= 0L) throw LegacyHeifDecodeException(LegacyHeifFailure.INVALID)
    if (sourceBytes > LegacyHeifDecodeLimits.MAX_SOURCE_BYTES) {
      throw LegacyHeifDecodeException(LegacyHeifFailure.TOO_LARGE)
    }
    ensureLibrariesLoaded()
    return try {
      DecodedObservationImage(
        value = nativeDecode(
          source.absolutePath,
          sourceBytes,
          LegacyHeifDecodeLimits.MAX_SOURCE_EDGE,
          LegacyHeifDecodeLimits.MAX_SOURCE_PIXELS,
          LegacyHeifDecodeLimits.MAX_OUTPUT_EDGE,
          LegacyHeifDecodeLimits.MAX_OUTPUT_PIXELS,
          LegacyHeifDecodeLimits.MAX_RGBA_BYTES,
        ),
        orientationApplied = true,
      )
    } catch (error: LegacyHeifNativeException) {
      throw LegacyHeifDecodeException(
        when (LegacyHeifNativeFailure.fromCode(error.failureCode)) {
          LegacyHeifNativeFailure.INVALID -> LegacyHeifFailure.INVALID
          LegacyHeifNativeFailure.TOO_LARGE -> LegacyHeifFailure.TOO_LARGE
          LegacyHeifNativeFailure.UNAVAILABLE -> LegacyHeifFailure.UNAVAILABLE
          LegacyHeifNativeFailure.ALLOCATION_FAILED -> LegacyHeifFailure.ALLOCATION_FAILED
        },
        error,
      )
    }
  }

  @Synchronized
  private fun ensureLibrariesLoaded() {
    if (librariesLoaded) return
    System.loadLibrary("de265")
    System.loadLibrary("heif")
    System.loadLibrary("hongtai_heif")
    librariesLoaded = true
  }

  private external fun nativeDecode(
    sourcePath: String,
    sourceBytes: Long,
    maxSourceEdge: Int,
    maxSourcePixels: Long,
    maxOutputEdge: Int,
    maxOutputPixels: Long,
    maxRgbaBytes: Long,
  ): Bitmap
}
