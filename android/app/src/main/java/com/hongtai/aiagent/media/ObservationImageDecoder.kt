package com.hongtai.aiagent.media

import java.io.File

internal data class DecodedObservationImage<T>(
  val value: T,
  val orientationApplied: Boolean,
)

internal fun interface ObservationImageDecoder<T> {
  fun decode(source: File): DecodedObservationImage<T>
}

internal enum class LegacyHeifFailure {
  INVALID,
  TOO_LARGE,
  UNAVAILABLE,
  ALLOCATION_FAILED,
}

internal class LegacyHeifDecodeException(
  val failure: LegacyHeifFailure,
  cause: Throwable? = null,
) : Exception(failure.name, cause)

internal class ObservationImageDecoderSelector<T>(
  private val platformDecoder: ObservationImageDecoder<T>,
  private val legacyHeifDecoder: ObservationImageDecoder<T>,
) {
  fun decode(sdkInt: Int, format: ImageFormat, source: File): DecodedObservationImage<T> = try {
    when (format) {
      ImageFormat.JPEG, ImageFormat.PNG, ImageFormat.WEBP -> platformDecoder.decode(source)
      ImageFormat.HEIF_CANDIDATE -> if (sdkInt in 24..25) {
        legacyHeifDecoder.decode(source)
      } else {
        platformDecoder.decode(source)
      }
      ImageFormat.UNSUPPORTED -> throw PrivateImageInvalidException("The selected file is not a supported image.")
    }
  } catch (error: LegacyHeifDecodeException) {
    throw when (error.failure) {
      LegacyHeifFailure.TOO_LARGE -> PrivateMediaTooLargeException("The selected image exceeds the safe decode limits.")
      LegacyHeifFailure.INVALID,
      LegacyHeifFailure.ALLOCATION_FAILED,
      -> PrivateImageInvalidException("The selected image could not be decoded safely.", error)
      LegacyHeifFailure.UNAVAILABLE -> PrivateMediaReadException("The image decoder is unavailable on this device.", error)
    }
  } catch (error: LinkageError) {
    throw PrivateMediaReadException("The image decoder is unavailable on this device.", error)
  } catch (error: OutOfMemoryError) {
    throw PrivateImageInvalidException("The selected image is too large to decode safely.", error)
  }
}

internal object ObservationImageTransformPolicy {
  fun <T> shouldApplyExif(decoded: DecodedObservationImage<T>): Boolean = !decoded.orientationApplied
}
