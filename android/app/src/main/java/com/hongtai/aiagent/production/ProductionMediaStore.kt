package com.hongtai.aiagent.production

import android.content.Context
import android.database.Cursor
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import com.hongtai.aiagent.bridge.LocalFilesPolicy
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID

internal data class ImportedProductionAsset(
  val id: String,
  val uri: String,
  val kind: ProductionAssetKind,
  val mimeType: String,
  val displayName: String,
  val sizeBytes: Long,
  val durationSeconds: Double?,
)

/** Owns bounded imports beneath one production project; no arbitrary path crosses the bridge. */
internal class ProductionMediaStore(context: Context) {
  private val appContext = context.applicationContext
  private val root = File(appContext.filesDir, "productions")

  fun importAll(projectId: String, uris: List<Uri>): List<ImportedProductionAsset> {
    require(uris.isNotEmpty() && uris.size <= MAX_ITEMS) { "Select between one and twelve production assets." }
    val inputs = inputsDirectory(projectId)
    val created = mutableListOf<File>()
    return try {
      uris.map { uri -> importOne(uri, inputs).also { created += File(requireNotNull(Uri.parse(it.uri).path)) } }
    } catch (error: Exception) {
      created.forEach(File::delete)
      throw error
    }
  }

  fun inputs(projectId: String): Map<String, ProductionInput> {
    val directory = inputsDirectory(projectId)
    return directory.listFiles()?.filter(File::isFile)?.associate { file ->
      val id = file.name.substringBeforeLast('.')
      require(ID_PATTERN.matches(id)) { "A production asset identifier is invalid." }
      val kind = kindFor(mimeForExtension(file.extension))
      id to ProductionInput(id, file.absolutePath, kind, if (kind == ProductionAssetKind.IMAGE) null else (durationSeconds(file) * 1_000).toLong())
    } ?: emptyMap()
  }

  fun outputTarget(projectId: String): Pair<File, File> {
    val directory = projectDirectory(projectId)
    return File(directory, ".output.part.mp4") to File(directory, "output.mp4")
  }

  fun audioDirectory(projectId: String): File = File(projectDirectory(projectId), "audio").also {
    if (!it.exists() && !it.mkdirs()) throw IllegalStateException("Could not create production audio storage.")
  }

  private fun importOne(uri: Uri, inputs: File): ImportedProductionAsset {
    require(uri.scheme == "content") { "Only system content URIs may be imported." }
    val displayName = safeName(displayNameFor(uri) ?: "素材")
    val mimeType = normalizedMime(uri, displayName)
    val kind = kindFor(mimeType)
    val id = UUID.randomUUID().toString()
    val destination = File(inputs, "$id.${extensionFor(mimeType)}")
    val temporary = File(inputs, ".$id.part")
    var written = 0L
    try {
      appContext.contentResolver.openInputStream(uri)?.use { input ->
        FileOutputStream(temporary).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            written += count
            require(written <= MAX_ITEM_BYTES) { "A production asset exceeds the supported size limit." }
            output.write(buffer, 0, count)
          }
          output.fd.sync()
        }
      } ?: throw IllegalArgumentException("The selected production asset could not be opened.")
      require(written > 0L) { "The selected production asset is empty." }
      if (!temporary.renameTo(destination)) throw IllegalStateException("Could not finalize the production asset.")
      val duration = if (kind == ProductionAssetKind.IMAGE) null else durationSeconds(destination)
      return ImportedProductionAsset(id, Uri.fromFile(destination).toString(), kind, mimeType, displayName, written, duration)
    } finally {
      temporary.delete()
    }
  }

  private fun projectDirectory(projectId: String): File {
    val normalized = LocalFilesPolicy.projectId(projectId)
    if (!root.exists() && !root.mkdirs()) throw IllegalStateException("Could not create production storage.")
    val directory = File(root, normalized).canonicalFile
    require(directory.path.startsWith("${root.canonicalPath}${File.separator}")) { "Production path escaped private storage." }
    if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Could not create production project storage.")
    return directory
  }

  private fun inputsDirectory(projectId: String): File = File(projectDirectory(projectId), "inputs").also {
    if (!it.exists() && !it.mkdirs()) throw IllegalStateException("Could not create production input storage.")
  }

  private fun displayNameFor(uri: Uri): String? = appContext.contentResolver.query(
    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null,
  )?.use { cursor: Cursor ->
    val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
    if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
  }

  private fun normalizedMime(uri: Uri, name: String): String {
    val provider = appContext.contentResolver.getType(uri)?.lowercase(Locale.ROOT)
    if (provider in SUPPORTED_MIME_TYPES) return requireNotNull(provider)
    val extensionMime = mimeForExtension(name.substringAfterLast('.', ""))
    require(extensionMime in SUPPORTED_MIME_TYPES) { "Only JPEG, PNG, WebP, MP4, MP3, M4A, and WAV assets are supported." }
    return extensionMime
  }

  private fun durationSeconds(file: File): Double {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      val milliseconds = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        ?: throw IllegalArgumentException("The selected media duration is unavailable.")
      require(milliseconds > 0L) { "The selected media duration is invalid." }
      milliseconds / 1_000.0
    } finally {
      retriever.release()
    }
  }

  private fun safeName(value: String): String = value.replace(Regex("[\\/\\u0000-\\u001F\\u007F]"), "_").trim().take(120).ifBlank { "素材" }

  private fun kindFor(mimeType: String): ProductionAssetKind = when {
    mimeType.startsWith("image/") -> ProductionAssetKind.IMAGE
    mimeType.startsWith("video/") -> ProductionAssetKind.VIDEO
    mimeType.startsWith("audio/") -> ProductionAssetKind.AUDIO
    else -> throw IllegalArgumentException("The production asset type is unsupported.")
  }

  private fun extensionFor(mimeType: String): String = when (mimeType) {
    "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/webp" -> "webp"; "video/mp4" -> "mp4"
    "audio/mpeg" -> "mp3"; "audio/mp4" -> "m4a"; "audio/wav" -> "wav"
    else -> throw IllegalArgumentException("The production asset type is unsupported.")
  }

  private fun mimeForExtension(extension: String): String = when (extension.lowercase(Locale.ROOT)) {
    "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "webp" -> "image/webp"; "mp4" -> "video/mp4"
    "mp3" -> "audio/mpeg"; "m4a" -> "audio/mp4"; "wav" -> "audio/wav"; else -> "application/octet-stream"
  }

  private companion object {
    val ID_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
    const val MAX_ITEMS = 12
    const val MAX_ITEM_BYTES = 250L * 1024L * 1024L
    val SUPPORTED_MIME_TYPES = setOf("image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mpeg", "audio/mp4", "audio/wav")
  }
}
