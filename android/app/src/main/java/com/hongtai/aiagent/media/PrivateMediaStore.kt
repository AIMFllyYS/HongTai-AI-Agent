package com.hongtai.aiagent.media

import android.content.Context
import android.database.Cursor
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
    val destination = File(importsDirectory, "${UUID.randomUUID()}-${PrivateMediaImportPolicy.safeFileName(sourceName)}")
    val temporary = File(importsDirectory, ".${destination.name}.${UUID.randomUUID()}.part")
    val providerMimeType = appContext.contentResolver.getType(uri)
    val copiedBytes = appContext.contentResolver.openInputStream(uri)?.use { input ->
      PrivateMediaImportPolicy.copyBounded(
        input = input,
        temporary = temporary,
        destination = destination,
        maxBytes = PrivateMediaImportPolicy.MAX_IMPORT_BYTES,
      )
    } ?: throw IllegalArgumentException("The selected media could not be opened.")

    val header = destination.inputStream().use { input -> input.readNBytes(12) }
    val mimeType = PrivateMediaImportPolicy.imageMimeType(providerMimeType, sourceName, header)
    return PrivateMediaFile(
      uri = Uri.fromFile(destination).toString(),
      mimeType = mimeType,
      sizeBytes = copiedBytes,
    )
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
  const val MAX_IMPORT_BYTES = 25L * 1024L * 1024L
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
    if (provider?.startsWith("image/") == true) return provider

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
          if (written > maxBytes) throw IllegalStateException("The selected media exceeds the private storage limit.")
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
