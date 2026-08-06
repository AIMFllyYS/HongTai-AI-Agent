package com.hongtai.aiagent.bridge

import android.content.Context
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.media.PrivateArtifactFile
import com.hongtai.aiagent.media.PrivateArtifactStore
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URLConnection
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Fixed app-private file bridge for standalone task and observation artifacts.
 * It exposes neither arbitrary paths nor directory listing outside the two
 * owned roots. Structured task state is atomically replaced; task events are
 * append-only.
 */
@CapacitorPlugin(name = "LocalFiles")
class LocalFilesPlugin : Plugin() {
  private val tasks: PrivateArtifactStore by lazy { PrivateArtifactStore(context) }
  private val observations: PrivateObservationFiles by lazy { PrivateObservationFiles(context) }

  @PluginMethod
  fun ensure(call: PluginCall) = execute(call) {
    tasks.createTaskRoot(call.requiredTaskId())
    call.resolve()
  }

  @PluginMethod
  fun writeText(call: PluginCall) = execute(call) {
    val taskId = call.requiredTaskId()
    val relativePath = call.requiredRelativePath()
    val value = call.requiredValue()
    val replace = call.getBoolean("replace", false) ?: false
    if (replace) tasks.replaceUtf8(taskId, relativePath, value) else tasks.writeUtf8(taskId, relativePath, value)
    call.resolve()
  }

  @PluginMethod
  fun appendText(call: PluginCall) = execute(call) {
    tasks.appendUtf8(call.requiredTaskId(), call.requiredRelativePath(), call.requiredValue())
    call.resolve()
  }

  @PluginMethod
  fun readText(call: PluginCall) = execute(call) {
    val value = tasks.readUtf8OrNull(call.requiredTaskId(), call.requiredRelativePath())
    call.resolve(JSObject().putOptional("value", value))
  }

  @PluginMethod
  fun exists(call: PluginCall) = execute(call) {
    val exists = tasks.exists(call.requiredTaskId(), call.requiredRelativePath())
    call.resolve(JSObject().put("exists", exists))
  }

  @PluginMethod
  fun listTaskIds(call: PluginCall) = execute(call) {
    call.resolve(JSObject().put("taskIds", JSArray(tasks.listTaskIds())))
  }

  @PluginMethod
  fun getUri(call: PluginCall) = execute(call) {
    call.resolve(tasks.fileInfo(call.requiredTaskId(), call.requiredRelativePath()).toJsObject())
  }

  @PluginMethod
  fun copyPrivateFile(call: PluginCall) = execute(call) {
    val sourceUri = call.requiredString("sourceUri")
    tasks.copyPrivateFile(call.requiredTaskId(), sourceUri, call.requiredRelativePath())
    call.resolve()
  }

  @PluginMethod
  fun ensureObservation(call: PluginCall) = execute(call) {
    observations.ensure(call.requiredSessionId())
    call.resolve()
  }

  @PluginMethod
  fun writeObservationText(call: PluginCall) = execute(call) {
    observations.writeText(
      sessionId = call.requiredSessionId(),
      relativePath = call.requiredRelativePath(),
      value = call.requiredValue(),
      replace = call.getBoolean("replace", false) ?: false,
    )
    call.resolve()
  }

  @PluginMethod
  fun readObservationText(call: PluginCall) = execute(call) {
    val value = observations.readTextOrNull(call.requiredSessionId(), call.requiredRelativePath())
    call.resolve(JSObject().putOptional("value", value))
  }

  @PluginMethod
  fun listObservationIds(call: PluginCall) = execute(call) {
    call.resolve(JSObject().put("sessionIds", JSArray(observations.listSessionIds())))
  }

  @PluginMethod
  fun copyToObservation(call: PluginCall) = execute(call) {
    val result = observations.copyPrivateFile(
      sessionId = call.requiredSessionId(),
      sourceUri = call.requiredString("sourceUri"),
      relativePath = call.requiredRelativePath(),
    )
    call.resolve(result.toJsObject())
  }

  @PluginMethod
  fun getObservationUri(call: PluginCall) = execute(call) {
    call.resolve(observations.fileInfo(call.requiredSessionId(), call.requiredRelativePath()).toJsObject())
  }

  private fun execute(call: PluginCall, action: () -> Unit) {
    FILE_EXECUTOR.execute {
      try {
        action()
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "Invalid local file input.", NativeIssueCode.INVALID_ARGUMENT, error)
      } catch (error: Exception) {
        call.reject(error.message ?: "The private local file operation failed.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      }
    }
  }

  private fun PluginCall.requiredTaskId(): String = LocalFilesPolicy.taskId(requiredString("taskId"))

  private fun PluginCall.requiredSessionId(): String = LocalFilesPolicy.sessionId(requiredString("sessionId"))

  private fun PluginCall.requiredRelativePath(): String = LocalFilesPolicy.relativePath(requiredString("relativePath"))

  private fun PluginCall.requiredValue(): String = getString("value") ?: throw IllegalArgumentException("value is required.")

  private fun PluginCall.requiredString(name: String): String = getString(name)?.takeIf { it.isNotBlank() }
    ?: throw IllegalArgumentException("$name is required.")

  private fun PrivateArtifactFile?.toJsObject(): JSObject = JSObject().also { target ->
    if (this != null) {
      target.put("uri", uri)
      target.put("sizeBytes", sizeBytes)
      target.putOptional("mimeType", mimeType)
    }
  }

  private fun JSObject.putOptional(name: String, value: Any?): JSObject = apply {
    if (value != null) put(name, value)
  }

  private companion object {
    val FILE_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-private-files").apply { isDaemon = true }
    }
  }
}

/** Pure standalone root/path policy, kept independent of Android I/O for JVM tests. */
internal object LocalFilesPolicy {
  private val identifier = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
  private val unsafeSegment = Regex("[\\\\\u0000-\u001F\u007F]")

  fun taskId(value: String): String = identifierValue(value, "Task identifier")

  fun sessionId(value: String): String = identifierValue(value, "Observation session identifier")

  fun relativePath(value: String): String {
    val normalized = value.trim().replace('\\', '/')
    require(normalized.isNotBlank() && !normalized.startsWith('/')) { "Artifact path must be relative." }
    val segments = normalized.split('/')
    require(segments.all { segment ->
      segment.isNotBlank() && segment != "." && segment != ".." && !unsafeSegment.containsMatchIn(segment)
    }) { "Artifact path contains an unsafe segment." }
    return segments.joinToString("/")
  }

  private fun identifierValue(value: String, label: String): String = value.takeIf(identifier::matches)
    ?: throw IllegalArgumentException("$label is invalid.")
}

private class PrivateObservationFiles(context: Context) {
  private val appContext = context.applicationContext
  private val root = File(appContext.filesDir, "observations")

  fun ensure(sessionId: String): File = directory(sessionId)

  fun writeText(sessionId: String, relativePath: String, value: String, replace: Boolean): PrivateArtifactFile {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_TEXT_BYTES) { "The observation text artifact exceeds its storage limit." }
    return ByteArrayInputStream(bytes).use { input ->
      writeStream(sessionId, relativePath, input, MAX_TEXT_BYTES.toLong(), replace, mimeTypeFor(relativePath))
    }
  }

  fun readTextOrNull(sessionId: String, relativePath: String): String? {
    val target = fileOrNull(sessionId, relativePath) ?: return null
    require(target.length() <= MAX_TEXT_BYTES) { "The observation text artifact exceeds its storage limit." }
    return FileInputStream(target).use { input -> input.readBytes().toString(Charsets.UTF_8) }
  }

  fun listSessionIds(): List<String> = root.listFiles()
    ?.asSequence()
    ?.filter { it.isDirectory }
    ?.mapNotNull { directory -> runCatching { LocalFilesPolicy.sessionId(directory.name) }.getOrNull() }
    ?.sorted()
    ?.toList()
    ?: emptyList()

  fun copyPrivateFile(sessionId: String, sourceUri: String, relativePath: String): PrivateArtifactFile {
    val source = requirePrivateInput(sourceUri)
    require(source.length() <= MAX_MEDIA_BYTES) { "The observation image exceeds its storage limit." }
    return FileInputStream(source).use { input ->
      writeStream(sessionId, relativePath, input, MAX_MEDIA_BYTES, true, mimeTypeFor(relativePath))
    }
  }

  fun fileInfo(sessionId: String, relativePath: String): PrivateArtifactFile? {
    val target = fileOrNull(sessionId, relativePath) ?: return null
    return PrivateArtifactFile(Uri.fromFile(target).toString(), target.length(), mimeTypeFor(relativePath))
  }

  private fun writeStream(
    sessionId: String,
    relativePath: String,
    input: java.io.InputStream,
    maxBytes: Long,
    replace: Boolean,
    mimeType: String?,
  ): PrivateArtifactFile {
    val target = targetFile(sessionId, relativePath)
    if (!replace) require(!target.exists()) { "A private observation artifact already exists at this path." }
    val temporary = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.part")
    var written = 0L
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          if (Thread.currentThread().isInterrupted) throw InterruptedException("Private file write was cancelled.")
          val count = input.read(buffer)
          if (count < 0) break
          written += count
          require(written <= maxBytes) { "The observation artifact exceeds its storage limit." }
          output.write(buffer, 0, count)
        }
        output.fd.sync()
      }
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not finalize the private observation artifact.")
      return PrivateArtifactFile(Uri.fromFile(target).toString(), written, mimeType)
    } catch (error: Exception) {
      if (temporary.exists()) temporary.delete()
      throw error
    }
  }

  private fun fileOrNull(sessionId: String, relativePath: String): File? {
    val directory = File(root, LocalFilesPolicy.sessionId(sessionId))
    if (!directory.isDirectory) return null
    val target = File(directory, LocalFilesPolicy.relativePath(relativePath)).canonicalFile
    requireInsideRoot(target)
    return target.takeIf(File::isFile)
  }

  private fun targetFile(sessionId: String, relativePath: String): File {
    val directory = directory(sessionId)
    val target = File(directory, LocalFilesPolicy.relativePath(relativePath)).canonicalFile
    requireInsideRoot(target)
    val parent = target.parentFile ?: throw IllegalStateException("The private observation directory is unavailable.")
    if (!parent.exists() && !parent.mkdirs()) throw IllegalStateException("Could not create the private observation directory.")
    return target
  }

  private fun directory(sessionId: String): File {
    val normalized = LocalFilesPolicy.sessionId(sessionId)
    if (!root.exists() && !root.mkdirs()) throw IllegalStateException("Could not create the private observation root.")
    val directory = File(root, normalized).canonicalFile
    requireInsideRoot(directory)
    if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Could not create the private observation directory.")
    return directory
  }

  private fun requirePrivateInput(uriValue: String): File {
    val uri = Uri.parse(uriValue)
    require(uri.scheme == "file") { "Only app-private file URIs are supported." }
    val path = uri.path ?: throw IllegalArgumentException("Private file URI is missing a path.")
    val file = File(path).canonicalFile
    val privateRoot = appContext.filesDir.canonicalFile
    require(file.path.startsWith("${privateRoot.path}${File.separator}") && file.isFile) {
      "The source URI is not an available private file."
    }
    return file
  }

  private fun requireInsideRoot(file: File) {
    val resolvedRoot = root.canonicalFile
    val resolved = file.canonicalFile
    require(resolved.path.startsWith("${resolvedRoot.path}${File.separator}")) {
      "The observation artifact path is outside private storage."
    }
  }

  private fun mimeTypeFor(relativePath: String): String? = when {
    relativePath.endsWith(".json") -> "application/json"
    relativePath.endsWith(".txt") -> "text/plain"
    else -> URLConnection.guessContentTypeFromName(relativePath)
  }

  private companion object {
    const val BUFFER_BYTES = 64 * 1024
    const val MAX_TEXT_BYTES = 2 * 1024 * 1024
    const val MAX_MEDIA_BYTES = 25L * 1024L * 1024L
  }
}
