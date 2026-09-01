package com.hongtai.aiagent.media

import android.content.Context
import android.net.Uri
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.URLConnection
import java.util.UUID

data class PrivateArtifactFile(
  val uri: String,
  val sizeBytes: Long,
  val mimeType: String? = null,
)

class PrivateArtifactLengthMismatchException(expectedBytes: Long, actualBytes: Long) : IllegalStateException(
  "The downloaded media size ($actualBytes bytes) does not match its declared size ($expectedBytes bytes).",
)

/** Pure pre-finalization guard so a truncated stream can never become an artifact. */
internal object PrivateArtifactWritePolicy {
  fun requireExpectedLength(expectedBytes: Long?, actualBytes: Long) {
    require(actualBytes >= 0L) { "The written artifact length is invalid." }
    if (expectedBytes != null) {
      require(expectedBytes >= 0L) { "The declared artifact length is invalid." }
      if (actualBytes != expectedBytes) throw PrivateArtifactLengthMismatchException(expectedBytes, actualBytes)
    }
  }
}

/**
 * App-private task artifacts. The WebView may name a task and a constrained
 * relative artifact kind, but never a raw filesystem path. All writes are
 * streamed into an adjacent temporary file and become visible only after a
 * successful rename.
 */
class PrivateArtifactStore(context: Context) {
  private val appContext = context.applicationContext
  private val taskRoot = File(appContext.filesDir, TASK_ROOT_NAME)

  fun createTaskRoot(taskId: String): String = taskDirectory(taskId).let(Uri::fromFile).toString()

  fun destinationForDownload(taskId: String, relativePath: String): File {
    val target = File(taskDirectory(taskId), PrivateArtifactPolicy.normalizeRelativePath(relativePath))
    requirePrivateTaskFile(target)
    target.parentFile?.let { parent ->
      if (!parent.exists() && !parent.mkdirs()) throw IllegalStateException("Could not create the private artifact directory.")
    }
    return target
  }

  fun writeStream(
    taskId: String,
    relativePath: String,
    input: InputStream,
    maxBytes: Long,
    expectedBytes: Long? = null,
    mimeType: String? = null,
    onBytesWritten: ((Long) -> Unit)? = null,
  ): PrivateArtifactFile {
    val target = destinationForDownload(taskId, relativePath)
    require(!target.exists()) { "A private artifact already exists at this task path." }
    val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.part")
    var written = 0L
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(DEFAULT_BUFFER_BYTES)
        while (true) {
          if (Thread.currentThread().isInterrupted) throw InterruptedException("Native file write was cancelled.")
          val count = input.read(buffer)
          if (count < 0) break
          written += count
          if (written > maxBytes) throw IllegalStateException("The downloaded media exceeds the private storage limit.")
          output.write(buffer, 0, count)
          onBytesWritten?.invoke(written)
        }
        output.fd.sync()
      }
      PrivateArtifactWritePolicy.requireExpectedLength(expectedBytes, written)
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not finalize the private artifact.")
      return PrivateArtifactFile(Uri.fromFile(target).toString(), written, mimeType)
    } catch (error: Exception) {
      if (temporary.exists()) temporary.delete()
      throw error
    }
  }

  /** Writes a small immutable UTF-8 task artifact through the same atomic finalization path. */
  fun writeUtf8(taskId: String, relativePath: String, value: String, maxBytes: Int = MAX_TEXT_BYTES): PrivateArtifactFile {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size <= maxBytes) { "The private text artifact exceeds its storage limit." }
    return ByteArrayInputStream(bytes).use { input ->
      writeStream(taskId, relativePath, input, maxBytes.toLong(), mimeType = "application/json")
    }
  }

  /**
   * Replaces a small structured artifact after the complete replacement has
   * been fsynced. This is used for the current task snapshot; immutable media
   * downloads continue to use [writeStream].
   */
  fun replaceUtf8(
    taskId: String,
    relativePath: String,
    value: String,
    maxBytes: Int = MAX_RUNTIME_TEXT_BYTES,
  ): PrivateArtifactFile {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size <= maxBytes) { "The private text artifact exceeds its storage limit." }
    return ByteArrayInputStream(bytes).use { input ->
      writeReplacingStream(taskId, relativePath, input, maxBytes.toLong(), mimeTypeFor(relativePath))
    }
  }

  /** Appends one bounded UTF-8 event line and fsyncs it before returning. */
  fun appendUtf8(
    taskId: String,
    relativePath: String,
    value: String,
    maxBytes: Int = MAX_RUNTIME_TEXT_BYTES,
  ) {
    val bytes = value.toByteArray(Charsets.UTF_8)
    val target = destinationForDownload(taskId, relativePath)
    require(target.length() + bytes.size <= maxBytes) { "The private text artifact exceeds its storage limit." }
    FileOutputStream(target, true).use { output ->
      output.write(bytes)
      output.fd.sync()
    }
  }

  /** Reads a fixed, app-private task artifact. There is no arbitrary file-read bridge. */
  fun readUtf8(taskId: String, relativePath: String, maxBytes: Int = MAX_TEXT_BYTES): String {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    require(directory.isDirectory) { "The private task artifact directory is unavailable." }
    val target = File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath))
    requirePrivateTaskFile(target)
    require(target.isFile && target.length() <= maxBytes) { "The private text artifact is unavailable." }
    return FileInputStream(target).use { input ->
      input.readBytes().toString(Charsets.UTF_8)
    }
  }

  /** Returns null only when the requested safe artifact is not present. */
  fun readUtf8OrNull(taskId: String, relativePath: String, maxBytes: Int = MAX_RUNTIME_TEXT_BYTES): String? {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    if (!directory.isDirectory) return null
    val target = File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath))
    requirePrivateTaskFile(target)
    if (!target.isFile) return null
    require(target.length() <= maxBytes) { "The private text artifact exceeds its storage limit." }
    return FileInputStream(target).use { input -> input.readBytes().toString(Charsets.UTF_8) }
  }

  fun exists(taskId: String, relativePath: String): Boolean {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    if (!directory.isDirectory) return false
    val target = File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath))
    requirePrivateTaskFile(target)
    return target.isFile
  }

  /** Resolves metadata for one existing task artifact without exposing a filesystem path. */
  fun fileInfo(taskId: String, relativePath: String): PrivateArtifactFile? {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    if (!directory.isDirectory) return null
    val target = File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath))
    requirePrivateTaskFile(target)
    if (!target.isFile) return null
    return PrivateArtifactFile(
      uri = Uri.fromFile(target).toString(),
      sizeBytes = target.length(),
      mimeType = mimeTypeFor(relativePath),
    )
  }

  fun listTaskIds(): List<String> = taskRoot.listFiles()
    ?.asSequence()
    ?.filter { it.isDirectory }
    ?.mapNotNull { directory ->
      runCatching { PrivateArtifactPolicy.taskDirectoryName(directory.name) }.getOrNull()
    }
    ?.sorted()
    ?.toList()
    ?: emptyList()

  /** Copies an existing app-private file into a safe task-relative destination. */
  fun copyPrivateFile(taskId: String, sourceUri: String, relativePath: String): PrivateArtifactFile {
    val source = requirePrivateInput(sourceUri)
    require(source.length() <= MAX_MEDIA_BYTES) { "The private media artifact exceeds its storage limit." }
    return FileInputStream(source).use { input ->
      writeReplacingStream(taskId, relativePath, input, MAX_MEDIA_BYTES, mimeTypeFor(relativePath))
    }
  }

  fun deleteArtifact(taskId: String, relativePath: String) {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    if (!directory.isDirectory) return
    val target = File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath)).canonicalFile
    requirePrivateTaskFile(target)
    if (target.exists() && (!target.isFile || !target.delete())) {
      throw IllegalStateException("Could not delete the private task artifact.")
    }
  }

  fun deleteTask(taskId: String, keepRelativePaths: Set<String> = emptySet()) {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId)).canonicalFile
    requirePrivateTaskFile(directory)
    if (!directory.exists()) return
    if (keepRelativePaths.isEmpty()) {
      if (!directory.deleteRecursively() || directory.exists()) {
        throw IllegalStateException("Could not delete the private task directory.")
      }
      return
    }
    val kept = keepRelativePaths.map { relativePath ->
      File(directory, PrivateArtifactPolicy.normalizeRelativePath(relativePath)).canonicalFile.also { requirePrivateTaskFile(it) }
    }.toSet()
    // Bottom-up: files first, then directories that became empty. Ancestors of a
    // kept file still contain it and survive; everything else is removed.
    directory.walkBottomUp().forEach { file ->
      if (file == directory) return@forEach
      if (file.isFile) {
        if (file !in kept && !file.delete()) throw IllegalStateException("Could not delete the private task artifact.")
      } else if (file.isDirectory && file.listFiles()?.isEmpty() == true && !file.delete()) {
        throw IllegalStateException("Could not delete the private task directory.")
      }
    }
  }

  /**
   * Stores a task-state snapshot as a new immutable artifact. The database
   * owns the matching timestamp; readers ignore snapshots that do not match
   * the current encrypted task row, avoiding a filesystem-only state change.
   */
  fun writeTaskStateSnapshot(taskId: String, updatedAtEpochMs: Long, value: String): PrivateArtifactFile {
    require(updatedAtEpochMs >= 0L) { "Task state snapshot timestamp is invalid." }
    return writeUtf8(taskId, "$TASK_STATE_DIRECTORY/${updatedAtEpochMs}-${UUID.randomUUID()}.json", value)
  }

  fun readTaskStateSnapshot(taskId: String, updatedAtEpochMs: Long): String? {
    require(updatedAtEpochMs >= 0L) { "Task state snapshot timestamp is invalid." }
    val directory = File(File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId)), TASK_STATE_DIRECTORY)
    if (!directory.isDirectory) return null
    requirePrivateTaskFile(directory)
    val prefix = "$updatedAtEpochMs-"
    val snapshot = directory.listFiles()
      ?.asSequence()
      ?.filter { file -> file.isFile && file.name.startsWith(prefix) && file.name.endsWith(".json") }
      ?.maxByOrNull { file -> file.name }
      ?: return null
    return readUtf8(taskId, "$TASK_STATE_DIRECTORY/${snapshot.name}")
  }

  /** Resolves only an existing regular file inside this app's private files root. */
  fun requirePrivateInput(uriValue: String): File {
    val uri = Uri.parse(uriValue)
    require(uri.scheme == "file") { "Only app-private file URIs are supported." }
    val file = File(requireNotNull(uri.path) { "Private file URI is missing a path." })
    val root = appContext.filesDir.canonicalFile
    val resolved = file.canonicalFile
    require(resolved.path.startsWith("${root.path}${File.separator}")) {
      "The file URI is outside private application storage."
    }
    require(resolved.isFile) { "The private file is unavailable." }
    return resolved
  }

  /** Resolves a private input that belongs to this exact task, never another task's artifacts. */
  fun requirePrivateTaskInput(taskId: String, uriValue: String): File {
    val file = requirePrivateInput(uriValue)
    val taskDirectory = taskDirectory(taskId)
    require(file.canonicalPath.startsWith("${taskDirectory.canonicalPath}${File.separator}")) {
      "The private input does not belong to the requested task."
    }
    return file
  }

  private fun writeReplacingStream(
    taskId: String,
    relativePath: String,
    input: InputStream,
    maxBytes: Long,
    mimeType: String?,
  ): PrivateArtifactFile {
    val target = destinationForDownload(taskId, relativePath)
    val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.part")
    var written = 0L
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(DEFAULT_BUFFER_BYTES)
        while (true) {
          if (Thread.currentThread().isInterrupted) throw InterruptedException("Native file write was cancelled.")
          val count = input.read(buffer)
          if (count < 0) break
          written += count
          if (written > maxBytes) throw IllegalStateException("The private artifact exceeds its storage limit.")
          output.write(buffer, 0, count)
        }
        output.fd.sync()
      }
      // Android's same-directory rename maps to the filesystem rename operation;
      // it keeps the prior snapshot intact if finalization fails.
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not finalize the private artifact.")
      return PrivateArtifactFile(Uri.fromFile(target).toString(), written, mimeType)
    } catch (error: Exception) {
      if (temporary.exists()) temporary.delete()
      throw error
    }
  }

  private fun taskDirectory(taskId: String): File {
    val directory = File(taskRoot, PrivateArtifactPolicy.taskDirectoryName(taskId))
    if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Could not create the private task directory.")
    return directory.canonicalFile.also(::requirePrivateTaskFile)
  }

  private fun requirePrivateTaskFile(file: File) {
    val root = taskRoot.canonicalFile
    val resolved = file.canonicalFile
    require(resolved.path.startsWith("${root.path}${File.separator}")) {
      "The artifact path is outside private task storage."
    }
  }

  private fun mimeTypeFor(relativePath: String): String? = when {
    relativePath.endsWith(".json") -> "application/json"
    relativePath.endsWith(".jsonl") -> "application/x-ndjson"
    relativePath.endsWith(".txt") || relativePath.endsWith(".html") -> "text/plain"
    relativePath.endsWith(".mp4") -> "video/mp4"
    relativePath.endsWith(".wav") -> "audio/wav"
    else -> URLConnection.guessContentTypeFromName(relativePath)
  }

  private companion object {
    const val TASK_ROOT_NAME = "tasks"
    const val TASK_STATE_DIRECTORY = "state"
    const val DEFAULT_BUFFER_BYTES = 64 * 1024
    const val MAX_TEXT_BYTES = 128 * 1024
    const val MAX_RUNTIME_TEXT_BYTES = 2 * 1024 * 1024
    const val MAX_MEDIA_BYTES = 1_073_741_824L
  }
}

/** Pure policy for task artifact paths, shared by storage and network layers. */
internal object PrivateArtifactPolicy {
  private val taskIdPattern = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
  private val unsafeSegment = Regex("[\\\\\u0000-\u001F\u007F]")

  fun taskDirectoryName(taskId: String): String = taskId.takeIf { taskIdPattern.matches(it) }
    ?: throw IllegalArgumentException("Task identifier is invalid.")

  fun normalizeRelativePath(value: String): String {
    val normalized = value.trim().replace('\\', '/')
    require(normalized.isNotBlank() && !normalized.startsWith('/')) { "Artifact path must be relative." }
    val segments = normalized.split('/')
    require(segments.all { segment ->
      segment.isNotBlank() && segment != "." && segment != ".." && !unsafeSegment.containsMatchIn(segment)
    }) { "Artifact path contains an unsafe segment." }
    return segments.joinToString("/")
  }
}
