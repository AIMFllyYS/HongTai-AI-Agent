package com.hongtai.aiagent.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Inspects the app's private data directory without exposing paths to the
 * WebView.  Delete handles are process-local and only point at one regular
 * file found during the latest inspection.
 */
@CapacitorPlugin(name = "LocalStorage")
class LocalStoragePlugin : Plugin() {
  private val entries = linkedMapOf<String, StorageEntry>()

  @PluginMethod
  fun inspect(call: PluginCall) = execute(call) {
    entries.clear()
    val items = JSArray()
    storageFiles().forEach { file ->
      val classification = classify(file)
      val id = "storage-${UUID.randomUUID().toString().replace("-", "").take(24)}"
      entries[id] = StorageEntry(file, classification.deletable, classification.guardStatusFile)
      items.put(
        JSObject()
          .put("id", id)
          .put("area", classification.area)
          .put("kind", classification.kind)
          .put("role", classification.role)
          .put("byteLength", file.length())
          .put("deletable", classification.deletable)
          .apply { classification.protectionCode?.let { put("protectionCode", it) } },
      )
    }
    call.resolve(
      JSObject()
        .put("schemaVersion", "native-storage.v1")
        .put("generatedAtEpochMs", System.currentTimeMillis())
        .put("items", items),
    )
  }

  @PluginMethod
  fun deleteItem(call: PluginCall) = execute(call) {
    val itemId = call.requiredItemId()
    val entry = entries[itemId] ?: throw IllegalArgumentException("Storage inspection has expired.")
    if (!entry.deletable) throw StorageProtectedException("Protected storage files cannot be deleted.")
    if (isBusy(entry.guardStatusFile)) throw StorageProtectedException("Active work files cannot be deleted.")
    if (entry.file.exists() && (!entry.file.isFile || !entry.file.delete())) {
      throw IllegalStateException("The selected storage file could not be deleted.")
    }
    entries.remove(itemId)
    call.resolve()
  }

  private fun storageFiles(): List<File> {
    val roots = buildList {
      add(context.applicationContext.dataDir.canonicalFile)
      context.applicationContext.externalCacheDir?.canonicalFile?.let(::add)
    }
    return roots.asSequence()
      .flatMap { root ->
        val canonicalRoot = root.canonicalFile
        root.walkTopDown().filter { file ->
          file.isFile && runCatching {
            file.canonicalPath.startsWith("${canonicalRoot.path}${File.separator}")
          }.getOrDefault(false)
        }
      }
      .sortedBy { it.path }
      .toList()
  }

  private fun classify(file: File): StorageClassification {
    val dataRoot = context.applicationContext.dataDir.canonicalFile
    val isExternalCache = !file.canonicalPath.startsWith("${dataRoot.path}${File.separator}")
    val relative = if (isExternalCache) "external-cache/${file.name}" else file.relativeTo(dataRoot).path.replace(File.separatorChar, '/')
    val lower = relative.lowercase()
    val parts = relative.split('/')
    val first = parts.firstOrNull().orEmpty()
    val extension = file.extension.lowercase()
    val kind = kindFor(extension, lower)

    if (isExternalCache || first == "cache" || first == "code_cache" || lower.contains("/cache/") || lower.startsWith("app_webview/")) {
      return StorageClassification("cache", if (kind == "other") "temporary" else kind, "cache", true)
    }
    if (extension == "part" || extension == "tmp") {
      return StorageClassification("cache", "temporary", "cache", true)
    }

    val area = when (first) {
      "tasks", "observations", "productions", "templates" -> first
      else -> "app-data"
    }
    val identifier = parts.getOrNull(1).orEmpty()
    val guardStatusFile = when (area) {
      "tasks" -> File(dataRoot, "tasks/$identifier/task.json")
      "observations" -> File(dataRoot, "observations/$identifier/report.json")
      "productions" -> File(dataRoot, "productions/$identifier/project.json")
      else -> null
    }
    val dataFile = extension in DATA_EXTENSIONS
    if (area == "app-data") {
      return StorageClassification(area, if (dataFile) "document" else kind, "app-data", false, "unknown")
    }
    if (dataFile) {
      return StorageClassification(area, "document", "app-data", false, "data", guardStatusFile)
    }
    if (kind == "other") {
      return StorageClassification(area, "other", "protected-other", false, "unknown", guardStatusFile)
    }
    val busy = isBusy(guardStatusFile)
    return StorageClassification(area, kind, mediaRole(area, lower, dataRoot, identifier), !busy, if (busy) "active" else null, guardStatusFile)
  }

  private fun mediaRole(area: String, path: String, dataRoot: File, identifier: String): String = when {
    area == "tasks" && path.contains("/media/video") -> if (taskSourceKind(dataRoot, identifier) == "local_video") "user-video" else "parsed-video"
    area == "tasks" && path.contains("/media/audio") -> "parsed-audio"
    area == "tasks" && path.contains("/media/image") -> "parsed-image"
    area == "observations" -> "observation-image"
    area == "productions" && path.contains("/inputs/") -> "production-asset"
    area == "productions" && path.contains("output") -> "production-output"
    area == "productions" && path.contains("insight") -> "derived-frame"
    area == "templates" -> "template-media"
    else -> "protected-other"
  }

  private fun taskSourceKind(dataRoot: File, taskId: String): String = runCatching {
    val file = File(dataRoot, "tasks/$taskId/task.json")
    if (!file.isFile || file.length() > MAX_JSON_BYTES) return@runCatching ""
    JSONObject(file.readText(Charsets.UTF_8)).optString("sourceKind", "")
  }.getOrDefault("")

  private fun isBusy(statusFile: File?): Boolean {
    if (statusFile == null || !statusFile.isFile || statusFile.length() > MAX_JSON_BYTES) return false
    val status = runCatching { JSONObject(statusFile.readText(Charsets.UTF_8)).optString("status", "") }.getOrDefault("")
    return status in BUSY_STATUSES
  }

  private fun execute(call: PluginCall, action: () -> Unit) {
    STORAGE_EXECUTOR.execute {
      try {
        action()
      } catch (error: StorageProtectedException) {
        call.reject(error.message ?: "Protected storage cannot be deleted.", "ERR_STORAGE_ITEM_PROTECTED", error)
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "Invalid storage input.", "ERR_STORAGE_ITEM_EXPIRED", error)
      } catch (error: Exception) {
        call.reject(error.message ?: "The storage operation failed.", "ERR_STORAGE_OPERATION_FAILED", error)
      }
    }
  }

  private fun PluginCall.requiredItemId(): String = getString("itemId")?.takeIf { it.matches(ITEM_ID_PATTERN) }
    ?: throw IllegalArgumentException("itemId is invalid.")

  private data class StorageEntry(val file: File, val deletable: Boolean, val guardStatusFile: File?)

  private data class StorageClassification(
    val area: String,
    val kind: String,
    val role: String,
    val deletable: Boolean,
    val protectionCode: String? = null,
    val guardStatusFile: File? = null,
  )

  private class StorageProtectedException(message: String) : IllegalStateException(message)

  private companion object {
    val STORAGE_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-storage-analysis").apply { isDaemon = true }
    }
    val ITEM_ID_PATTERN = Regex("storage-[A-Za-z0-9]{12,64}")
    val DATA_EXTENSIONS = setOf("json", "jsonl", "txt", "md", "xml", "db", "sqlite")
    val BUSY_STATUSES = setOf("queued", "running", "planning", "rendering")
    const val MAX_JSON_BYTES = 2L * 1024L * 1024L

    fun kindFor(extension: String, path: String): String = when {
      extension in setOf("mp4", "mov", "m4v", "webm") || path.contains("/video") -> "video"
      extension in setOf("jpg", "jpeg", "png", "webp", "heic", "heif") || path.contains("/image") || path.contains("/cover") -> "image"
      extension in setOf("wav", "mp3", "m4a", "aac", "ogg") || path.contains("/audio") -> "audio"
      extension in DATA_EXTENSIONS -> "document"
      extension in setOf("part", "tmp") -> "temporary"
      else -> "other"
    }
  }
}
