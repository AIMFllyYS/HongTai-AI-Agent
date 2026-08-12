package com.hongtai.aiagent.media

import android.content.Context
import android.database.Cursor
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import java.io.PushbackInputStream

internal data class ImportedTaskVideo(
  val uri: String,
  val mimeType: String,
  val displayName: String,
  val sizeBytes: Long,
  val durationSeconds: Double,
)

/** Copies one system-selected MP4 directly into the requesting task's fixed private media slot. */
internal class TaskVideoImportStore(context: Context) {
  private val appContext = context.applicationContext
  private val artifacts = PrivateArtifactStore(appContext)

  fun import(taskId: String, sourceUri: Uri): ImportedTaskVideo {
    val mimeType = appContext.contentResolver.getType(sourceUri)?.lowercase()
    val metadata = queryMetadata(sourceUri)
    val source = appContext.contentResolver.openInputStream(sourceUri)
      ?: throw PrivateMediaReadException("The selected task video could not be opened.")
    val artifact = try {
      source.use { input ->
        PushbackInputStream(input, HEADER_BYTES).use { buffered ->
          val header = ByteArray(HEADER_BYTES)
          val count = buffered.read(header)
          require(count > 0) { "The selected task video is empty." }
          buffered.unread(header, 0, count)
          TaskVideoImportPolicy.requireSupported(sourceUri.scheme, mimeType, metadata.sizeBytes, header.copyOf(count))
          artifacts.writeStream(
            taskId = taskId,
            relativePath = TASK_VIDEO_PATH,
            input = buffered,
            maxBytes = TaskVideoImportPolicy.MAX_BYTES,
            mimeType = "video/mp4",
          )
        }
      }
    } catch (error: SecurityException) {
      throw PrivateMediaReadException("The selected task video permission is unavailable.", error)
    }

    try {
      val file = artifacts.requirePrivateTaskInput(taskId, artifact.uri)
      val duration = probeDuration(file.absolutePath)
      return ImportedTaskVideo(
        uri = artifact.uri,
        mimeType = "video/mp4",
        displayName = safeName(metadata.displayName ?: "本地视频.mp4"),
        sizeBytes = artifact.sizeBytes,
        durationSeconds = duration,
      )
    } catch (error: Exception) {
      artifacts.deleteArtifact(taskId, TASK_VIDEO_PATH)
      throw error
    }
  }

  private fun probeDuration(path: String): Double {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(path)
      require(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes") {
        "The selected MP4 has no video track."
      }
      val milliseconds = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
      require(milliseconds != null && milliseconds > 0L) { "The selected task video duration is invalid." }
      milliseconds / 1_000.0
    } finally {
      retriever.release()
    }
  }

  private fun queryMetadata(uri: Uri): VideoSourceMetadata = appContext.contentResolver.query(
    uri,
    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
    null,
    null,
    null,
  )?.use { cursor: Cursor ->
    if (!cursor.moveToFirst()) return@use VideoSourceMetadata(null, null)
    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
    VideoSourceMetadata(
      displayName = nameIndex.takeIf { it >= 0 }?.let(cursor::getString),
      sizeBytes = sizeIndex.takeIf { it >= 0 && !cursor.isNull(it) }?.let(cursor::getLong),
    )
  } ?: VideoSourceMetadata(null, null)

  private fun safeName(value: String): String = value
    .replace(Regex("[\\/\\u0000-\\u001F\\u007F]"), "_")
    .trim()
    .take(120)
    .ifBlank { "本地视频.mp4" }

  private data class VideoSourceMetadata(val displayName: String?, val sizeBytes: Long?)

  private companion object {
    const val HEADER_BYTES = 32
    const val TASK_VIDEO_PATH = "media/video.mp4"
  }
}
