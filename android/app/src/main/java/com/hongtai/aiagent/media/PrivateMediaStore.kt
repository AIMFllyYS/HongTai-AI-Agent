package com.hongtai.aiagent.media

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.text.Normalizer
import java.util.UUID

data class PrivateMediaFile(
  val uri: String,
  val mimeType: String?,
  val sizeBytes: Long,
)

class PrivateMediaTooLargeException(message: String) : IllegalStateException(message)

class PrivateImageInvalidException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

class PrivateMediaReadException(message: String, cause: Throwable? = null) : IOException(message, cause)

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

  @Suppress("UNUSED_PARAMETER")
  fun importFrom(uri: Uri, displayName: String? = null): PrivateMediaFile {
    require(PrivateMediaImportPolicy.acceptsSourceScheme(uri.scheme)) {
      "Only system content URIs may be imported into private media storage."
    }
    if (!importsDirectory.exists() && !importsDirectory.mkdirs()) {
      throw IllegalStateException("Could not create the private media directory.")
    }

    val identifier = UUID.randomUUID().toString()
    val stagedSource = File(importsDirectory, ".$identifier.source")
    val stagedTemporary = File(importsDirectory, ".$identifier.source.part")
    val destination = File(importsDirectory, "$identifier.jpg")
    val destinationTemporary = File(importsDirectory, ".$identifier.jpg.part")
    try {
      val source = try {
        appContext.contentResolver.openInputStream(uri)
      } catch (error: IOException) {
        throw PrivateMediaReadException("The selected image could not be opened.", error)
      } catch (error: SecurityException) {
        throw PrivateMediaReadException("The selected image permission is no longer available.", error)
      } ?: throw PrivateMediaReadException("The selected image could not be opened.")
      try {
        source.use { input ->
          PrivateMediaImportPolicy.copyBounded(
            input = input,
            temporary = stagedTemporary,
            destination = stagedSource,
            maxBytes = PrivateMediaImportPolicy.MAX_IMPORT_BYTES,
          )
        }
      } catch (error: PrivateMediaTooLargeException) {
        throw error
      } catch (error: IOException) {
        throw PrivateMediaReadException("The selected image could not be read.", error)
      } catch (error: SecurityException) {
        throw PrivateMediaReadException("The selected image permission is no longer available.", error)
      }

      val sourceFormat = ImageFormatProbe.probe(stagedSource)
      if (sourceFormat == ImageFormat.UNSUPPORTED) {
        throw PrivateImageInvalidException("The selected file is not a supported JPEG, PNG, WebP, or HEIF image.")
      }
      PrivateObservationImageNormalizer.normalize(
        source = stagedSource,
        sourceFormat = sourceFormat,
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

  /** Rebuilds a camera staging handle without persisting or accepting a private path. */
  fun restorePhotoCapture(captureFileName: String): PendingPhotoCapture? {
    if (!PhotoCapturePolicy.isCaptureFileName(captureFileName)) return null
    val root = captureDirectory.canonicalFile
    val file = File(root, captureFileName).canonicalFile
    if (file.parentFile?.canonicalFile != root || !file.isFile) return null
    val uri = try {
      FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", file)
    } catch (_: IllegalArgumentException) {
      return null
    }
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

  fun readHeader(input: InputStream): ByteArray {
    val header = ByteArray(12)
    var offset = 0
    while (offset < header.size) {
      val count = input.read(header, offset, header.size - offset)
      if (count <= 0) break
      offset += count
    }
    return header.copyOf(offset)
  }

  /** Compatibility seam for byte-authority policy tests; production uses the full bounded probe. */
  @Suppress("UNUSED_PARAMETER")
  fun imageMimeType(providerMimeType: String?, displayName: String?, header: ByteArray): String? =
    when (ImageFormatProbe.probe(header.inputStream(), header.size.toLong())) {
      ImageFormat.JPEG -> "image/jpeg"
      ImageFormat.PNG -> "image/png"
      ImageFormat.WEBP -> "image/webp"
      ImageFormat.HEIF_CANDIDATE -> "image/heif"
      ImageFormat.UNSUPPORTED -> null
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
}
