package com.hongtai.aiagent.media

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.text.Normalizer
import java.util.UUID

data class PrivateMediaFile(
  val uri: String,
  val mimeType: String?,
  val sizeBytes: Long,
)

/** Copies a selected document immediately into the application's private files directory. */
class PrivateMediaStore(context: Context) {
  private val appContext = context.applicationContext
  private val importsDirectory = File(appContext.filesDir, "media/imports")

  fun importFrom(uri: Uri, displayName: String? = null): PrivateMediaFile {
    require(PrivateMediaImportPolicy.acceptsSourceScheme(uri.scheme)) {
      "Only system content URIs may be imported into private media storage."
    }
    if (!importsDirectory.exists() && !importsDirectory.mkdirs()) {
      throw IllegalStateException("Could not create the private media directory.")
    }

    val sourceName = displayName?.takeIf { it.isNotBlank() } ?: displayNameFor(uri) ?: "media"
    val destination = File(importsDirectory, "${UUID.randomUUID()}-${PrivateMediaImportPolicy.safeFileName(sourceName)}")
    val copiedBytes = appContext.contentResolver.openInputStream(uri)?.use { input ->
      FileOutputStream(destination).use { output -> input.copyTo(output) }
    } ?: throw IllegalArgumentException("The selected media could not be opened.")

    return PrivateMediaFile(
      uri = Uri.fromFile(destination).toString(),
      mimeType = appContext.contentResolver.getType(uri),
      sizeBytes = copiedBytes,
    )
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
}
