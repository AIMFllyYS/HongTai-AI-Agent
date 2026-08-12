package com.hongtai.aiagent.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.os.Build
import com.hongtai.aiagent.media.heif.LegacyHeifDecoder
import java.io.File
import java.io.FileOutputStream

/** The single Android I/O entry point that publishes a normalized private JPEG. */
internal object PrivateObservationImageNormalizer {
  private const val MAX_EDGE_PIXELS = 2_048
  private const val SAFE_DECODE_EDGE_PIXELS = 3_072
  private const val JPEG_QUALITY = 90

  fun normalize(
    source: File,
    sourceFormat: ImageFormat,
    temporary: File,
    destination: File,
  ) {
    val selector = ObservationImageDecoderSelector(
      platformDecoder = PlatformBitmapDecoder,
      legacyHeifDecoder = LegacyHeifDecoder,
    )
    var decoded: Bitmap? = null
    var oriented: Bitmap? = null
    var scaled: Bitmap? = null
    var flattened: Bitmap? = null
    var published = false
    try {
      val result = selector.decode(Build.VERSION.SDK_INT, sourceFormat, source)
      decoded = result.value
      oriented = if (ObservationImageTransformPolicy.shouldApplyExif(result)) {
        applyExifOrientation(decoded, source)
      } else {
        decoded
      }
      scaled = scaleToFit(oriented, MAX_EDGE_PIXELS)
      flattened = Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888)
      Canvas(flattened).apply {
        drawColor(Color.WHITE)
        drawBitmap(scaled, 0f, 0f, null)
      }
      FileOutputStream(temporary).use { output ->
        if (!flattened.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) {
          throw PrivateImageInvalidException("The selected image could not be normalized.")
        }
        output.fd.sync()
      }
      if (temporary.length() <= 0L || temporary.length() > PrivateMediaImportPolicy.MAX_IMPORT_BYTES) {
        throw PrivateMediaTooLargeException("The normalized image exceeds the private storage limit.")
      }
      if (!temporary.renameTo(destination)) {
        throw IllegalStateException("Could not finalize the normalized private image.")
      }
      published = true
    } catch (error: OutOfMemoryError) {
      throw PrivateImageInvalidException("The selected image is too large to decode safely.", error)
    } finally {
      if (!published) temporary.delete()
      listOf(flattened, scaled, oriented, decoded).distinct().forEach { bitmap ->
        if (bitmap != null && !bitmap.isRecycled) bitmap.recycle()
      }
    }
  }

  private object PlatformBitmapDecoder : ObservationImageDecoder<Bitmap> {
    override fun decode(source: File): DecodedObservationImage<Bitmap> {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(source.absolutePath, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw PrivateImageInvalidException("The selected image could not be decoded.")
      }
      val options = BitmapFactory.Options().apply {
        inPreferredConfig = Bitmap.Config.ARGB_8888
        inSampleSize = decodeSample(bounds.outWidth, bounds.outHeight)
      }
      return DecodedObservationImage(
        value = BitmapFactory.decodeFile(source.absolutePath, options)
          ?: throw PrivateImageInvalidException("The selected image could not be decoded."),
        orientationApplied = false,
      )
    }
  }

  private fun decodeSample(width: Int, height: Int): Int {
    var sample = 1
    while (maxOf(width, height) / sample > SAFE_DECODE_EDGE_PIXELS && sample <= Int.MAX_VALUE / 2) sample *= 2
    return sample
  }

  private fun applyExifOrientation(bitmap: Bitmap, source: File): Bitmap {
    val orientation = try {
      ExifInterface(source.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  private fun scaleToFit(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val edge = maxOf(bitmap.width, bitmap.height)
    if (edge <= maxEdge) return bitmap
    val scale = maxEdge.toFloat() / edge.toFloat()
    return Bitmap.createScaledBitmap(
      bitmap,
      (bitmap.width * scale).toInt().coerceAtLeast(1),
      (bitmap.height * scale).toInt().coerceAtLeast(1),
      true,
    )
  }
}
