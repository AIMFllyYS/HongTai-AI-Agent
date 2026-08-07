package com.hongtai.aiagent.media

import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

data class PrivateMediaFile(
  val uri: String,
  val mimeType: String?,
  val sizeBytes: Long,
)

class PrivateMediaTooLargeException(message: String) : IllegalStateException(message)

class PrivateImageInvalidException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

/** A one-use FileProvider target for an external system camera activity. */
class PendingPhotoCapture internal constructor(
  val uri: Uri,
  internal val file: File,
)

/** Copies a selected document immediately into the application's private files directory. */
class PrivateMediaStore(context: Context) {
  private val appContext = context.applicationContext
  private val importsDirectory = File(appContext.filesDir, "media/imports")
  private val captureDirectory = File(appContext.cacheDir, "media/capture")

  fun importFrom(uri: Uri, displayName: String? = null): PrivateMediaFile {
    require(PrivateMediaImportPolicy.acceptsSourceScheme(uri.scheme)) {
      "Only system content URIs may be imported into private media storage."
    }
    if (!importsDirectory.exists() && !importsDirectory.mkdirs()) {
      throw IllegalStateException("Could not create the private media directory.")
    }

    val sourceName = displayName?.takeIf { it.isNotBlank() } ?: displayNameFor(uri) ?: "media"
    val identifier = UUID.randomUUID().toString()
    val stagedSource = File(importsDirectory, ".$identifier.source")
    val stagedTemporary = File(importsDirectory, ".$identifier.source.part")
    val destination = File(importsDirectory, "$identifier.jpg")
    val destinationTemporary = File(importsDirectory, ".$identifier.jpg.part")
    val providerMimeType = appContext.contentResolver.getType(uri)
    try {
      appContext.contentResolver.openInputStream(uri)?.use { input ->
        PrivateMediaImportPolicy.copyBounded(
          input = input,
          temporary = stagedTemporary,
          destination = stagedSource,
          maxBytes = PrivateMediaImportPolicy.MAX_IMPORT_BYTES,
        )
      } ?: throw PrivateImageInvalidException("The selected image could not be opened.")

      val header = stagedSource.inputStream().use { input -> input.readNBytes(12) }
      val sourceMimeType = PrivateMediaImportPolicy.imageMimeType(providerMimeType, sourceName, header)
        ?: throw PrivateImageInvalidException("The selected file is not a supported JPEG, PNG, or WebP image.")
      PrivateObservationImageNormalizer.normalize(
        source = stagedSource,
        sourceMimeType = sourceMimeType,
        temporary = destinationTemporary,
        destination = destination,
      )
      return PrivateMediaFile(
        uri = Uri.fromFile(destination).toString(),
        mimeType = "image/jpeg",
        sizeBytes = destination.length(),
      )
    } finally {
      stagedTemporary.delete()
      stagedSource.delete()
      destinationTemporary.delete()
      if (destination.exists() && destination.length() <= 0L) destination.delete()
    }
  }

  /**
   * Creates a temporary, app-owned output URI for the system camera. It is
   * deliberately under cache rather than the final imports directory so a
   * cancelled capture can never appear as user media.
   */
  fun createPhotoCapture(): PendingPhotoCapture {
    if (!captureDirectory.exists() && !captureDirectory.mkdirs()) {
      throw IllegalStateException("Could not create the private camera staging directory.")
    }
    val identifier = UUID.randomUUID().toString()
    val file = File(captureDirectory, PhotoCapturePolicy.fileNameFor(identifier)).canonicalFile
    val root = captureDirectory.canonicalFile
    require(file.parentFile?.canonicalFile == root) { "Camera target is outside private staging storage." }
    val uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", file)
    return PendingPhotoCapture(uri, file)
  }

  /** Copies a non-empty captured file into the same private imported-media area as picker results. */
  fun importCaptured(capture: PendingPhotoCapture): PrivateMediaFile = try {
    require(capture.file.isFile && capture.file.length() > 0L) { "The camera did not produce a usable photo." }
    val imported = importFrom(capture.uri, "captured-photo.jpg")
    if (imported.mimeType == null) imported.copy(mimeType = "image/jpeg") else imported
  } finally {
    capture.file.delete()
  }

  /** Removes a cancelled or failed camera staging file without touching imported user media. */
  fun discardCapture(capture: PendingPhotoCapture) {
    capture.file.delete()
  }

  private fun displayNameFor(uri: Uri): String? = appContext.contentResolver.query(
    uri,
    arrayOf(OpenableColumns.DISPLAY_NAME),
    null,
    null,
    null,
  )?.use { cursor: Cursor ->
    val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
    if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
  }

}

/** Pure policy so URI/file-name boundaries are unit-testable without a device. */
internal object PrivateMediaImportPolicy {
  private val unsafePathCharacters = Regex("[\\\\/\\u0000-\\u001F\\u007F]")
  const val MAX_IMPORT_BYTES = 15L * 1024L * 1024L
  private const val BUFFER_BYTES = 64 * 1024

  /**
   * The WebView can ask to copy only a system content URI. In particular, a
   * file:// URI is never a read proxy into the app's private directory.
   */
  fun acceptsSourceScheme(scheme: String?): Boolean = scheme == "content"

  /** Keeps user-visible Unicode names while removing path/control characters. */
  fun safeFileName(value: String): String {
    val normalized = Normalizer.normalize(value, Normalizer.Form.NFC)
      .replace(unsafePathCharacters, "_")
      .trim()
      .take(120)
    return normalized.ifBlank { "media" }
  }

  fun imageMimeType(providerMimeType: String?, displayName: String?, header: ByteArray): String? {
    val provider = providerMimeType?.trim()?.lowercase(Locale.ROOT)
    if (provider in SUPPORTED_IMAGE_MIME_TYPES) return provider

    when (displayName?.substringAfterLast('.', "")?.lowercase(Locale.ROOT)) {
      "jpg", "jpeg" -> return "image/jpeg"
      "png" -> return "image/png"
      "webp" -> return "image/webp"
    }

    if (header.size >= 3 && header[0] == 0xff.toByte() && header[1] == 0xd8.toByte() && header[2] == 0xff.toByte()) {
      return "image/jpeg"
    }
    if (header.size >= 8 && header.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))) {
      return "image/png"
    }
    if (header.size >= 12 && header.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
      header.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP") {
      return "image/webp"
    }
    return null
  }

  /**
   * Streams an externally selected item into a same-directory temporary file.
   * The final path becomes visible only after the complete bounded write has
   * been flushed and atomically renamed into place.
   */
  fun copyBounded(
    input: InputStream,
    temporary: File,
    destination: File,
    maxBytes: Long,
  ): Long {
    require(maxBytes >= 0L) { "The private media storage limit is invalid." }
    val temporaryParent = temporary.parentFile?.canonicalFile
      ?: throw IllegalArgumentException("The private media temporary path is invalid.")
    val destinationParent = destination.parentFile?.canonicalFile
      ?: throw IllegalArgumentException("The private media destination path is invalid.")
    require(temporaryParent == destinationParent) { "Private media finalization must stay in one directory." }
    require(!temporary.exists()) { "The private media temporary path already exists." }
    require(!destination.exists()) { "The private media destination already exists." }

    var written = 0L
    var published = false
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          if (Thread.currentThread().isInterrupted) throw InterruptedException("Private media import was cancelled.")
          val count = input.read(buffer)
          if (count < 0) break
          if (count == 0) continue
          written += count
          if (written > maxBytes) throw PrivateMediaTooLargeException("The selected image exceeds the private storage limit.")
          output.write(buffer, 0, count)
        }
        output.fd.sync()
      }
      if (!temporary.renameTo(destination)) throw IllegalStateException("Could not finalize the private media import.")
      published = true
      return written
    } finally {
      if (!published && temporary.exists()) temporary.delete()
    }
  }

  private val SUPPORTED_IMAGE_MIME_TYPES = setOf("image/jpeg", "image/png", "image/webp")
}

/** Mirrors the CLI image contract before any bytes cross the AI transport boundary. */
private object PrivateObservationImageNormalizer {
  private const val MAX_EDGE_PIXELS = 2_048
  private const val SAFE_DECODE_EDGE_PIXELS = 3_072
  private const val JPEG_QUALITY = 90

  fun normalize(
    source: File,
    sourceMimeType: String,
    temporary: File,
    destination: File,
  ) {
    require(sourceMimeType == "image/jpeg" || sourceMimeType == "image/png" || sourceMimeType == "image/webp")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw PrivateImageInvalidException("The selected image could not be decoded.")
    }

    val options = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inSampleSize = decodeSample(bounds.outWidth, bounds.outHeight)
    }
    var decoded: Bitmap? = null
    var oriented: Bitmap? = null
    var scaled: Bitmap? = null
    var flattened: Bitmap? = null
    var published = false
    try {
      decoded = BitmapFactory.decodeFile(source.absolutePath, options)
        ?: throw PrivateImageInvalidException("The selected image could not be decoded.")
      oriented = applyExifOrientation(decoded, source)
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

  private fun decodeSample(width: Int, height: Int): Int {
    var sample = 1
    while (maxOf(width, height) / sample > SAFE_DECODE_EDGE_PIXELS && sample <= Int.MAX_VALUE / 2) {
      sample *= 2
    }
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
