package com.hongtai.aiagent.bridge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.StatFs
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Capacitor glue over [StorageScanner].  Delete handles are process-local and
 * only point at one regular file found during the latest listing; any new
 * inspect/listAreaItems/clearCache call invalidates outstanding handles.
 * Only forward-slash paths relative to the data directory cross the bridge.
 */
@CapacitorPlugin(name = "LocalStorage")
class LocalStoragePlugin : Plugin() {
  private val entries = linkedMapOf<String, StorageEntry>()

  private val scanner: StorageScanner by lazy {
    val app = context.applicationContext
    StorageScanner(app.dataDir, app.filesDir, app.cacheDir, app.externalCacheDir)
  }

  @PluginMethod
  fun inspect(call: PluginCall) = execute(call) {
    entries.clear()
    val snapshot = scanner.inspect()
    val areas = JSArray()
    snapshot.areas.forEach { summary ->
      areas.put(
        JSObject()
          .put("area", summary.area)
          .put("byteLength", summary.byteLength)
          .put("itemCount", summary.itemCount)
          .put("deletableByteLength", summary.deletableByteLength)
          .put("protectedByteLength", summary.protectedByteLength),
      )
    }
    val groups = JSArray()
    snapshot.appDataGroups.forEach { group ->
      groups.put(JSObject().put("key", group.key).put("byteLength", group.byteLength))
    }
    call.resolve(
      JSObject()
        .put("schemaVersion", SCHEMA_VERSION)
        .put("generatedAtEpochMs", System.currentTimeMillis())
        .put("device", deviceStorage())
        .put("areas", areas)
        .put("appDataGroups", groups),
    )
  }

  @PluginMethod
  fun listAreaItems(call: PluginCall) = execute(call) {
    val area = call.getString("area")?.takeIf { it in LISTABLE_AREAS }
      ?: throw IllegalArgumentException("The storage area is invalid.")
    entries.clear()
    val items = JSArray()
    scanner.listAreaItems(area).forEach { item ->
      val id = "storage-${UUID.randomUUID().toString().replace("-", "").take(24)}"
      entries[id] = StorageEntry(item.file, item.deletable, item.guardStatusFile)
      items.put(
        JSObject()
          .put("id", id)
          .put("area", item.area)
          .put("kind", item.kind)
          .put("role", item.role)
          .put("byteLength", item.byteLength)
          .put("deletable", item.deletable)
          .put("title", item.title)
          .put("relativePath", item.relativePath)
          .apply { item.protectionCode?.let { put("protectionCode", it) } }
          .apply { item.group?.let { put("group", it) } },
      )
    }
    call.resolve(
      JSObject()
        .put("schemaVersion", SCHEMA_VERSION)
        .put("area", area)
        .put("generatedAtEpochMs", System.currentTimeMillis())
        .put("items", items),
    )
  }

  @PluginMethod
  fun deleteItem(call: PluginCall) = execute(call) {
    val itemId = call.requiredItemId()
    val entry = entries[itemId] ?: throw IllegalArgumentException("Storage inspection has expired.")
    if (!entry.deletable) throw StorageProtectedException("Protected storage files cannot be deleted.")
    if (scanner.isBusy(entry.guardStatusFile)) throw StorageProtectedException("Active work files cannot be deleted.")
    if (entry.file.exists() && (!entry.file.isFile || !entry.file.delete())) {
      throw IllegalStateException("The selected storage file could not be deleted.")
    }
    entries.remove(itemId)
    call.resolve()
  }

  @PluginMethod
  fun clearCache(call: PluginCall) = execute(call) {
    val result = scanner.clearCache()
    entries.clear()
    call.resolve(
      JSObject()
        .put("deletedCount", result.deletedCount)
        .put("failedCount", result.failedCount)
        .put("freedBytes", result.freedBytes),
    )
  }

  @PluginMethod
  fun exportReport(call: PluginCall) = execute(call) {
    val text = call.getString("text")?.takeIf { it.isNotBlank() }
      ?: throw IllegalArgumentException("The report text is required.")
    val bytes = text.toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_REPORT_BYTES) { "The report text exceeds its size limit." }
    val app = context.applicationContext
    val report = File(app.cacheDir, "storage-report-${System.currentTimeMillis()}.txt")
    writeAtomically(report, bytes)
    val uri = FileProvider.getUriForFile(app, "${app.packageName}.fileprovider", report)
    val intent = Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      app.startActivity(intent)
    } catch (error: ActivityNotFoundException) {
      throw IllegalStateException("No activity can share the storage report.", error)
    }
    call.resolve()
  }

  private fun writeAtomically(target: File, bytes: ByteArray) {
    val temporary = File(target.parentFile, ".${target.name}.part")
    try {
      FileOutputStream(temporary).use { output ->
        output.write(bytes)
        output.fd.sync()
      }
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not finalize the storage report.")
    } catch (error: Exception) {
      if (temporary.exists()) temporary.delete()
      throw error
    }
  }

  private fun deviceStorage(): JSObject {
    val stats = StatFs(context.applicationContext.dataDir.path)
    return JSObject().put("totalBytes", stats.totalBytes).put("freeBytes", stats.availableBytes)
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

  private class StorageProtectedException(message: String) : IllegalStateException(message)

  private companion object {
    val STORAGE_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-storage-analysis").apply { isDaemon = true }
    }
    val ITEM_ID_PATTERN = Regex("storage-[A-Za-z0-9]{12,64}")
    val LISTABLE_AREAS = setOf("tasks", "observations", "productions", "templates", "cache")
    const val SCHEMA_VERSION = "native-storage.v2"
    const val MAX_REPORT_BYTES = 64 * 1024
  }
}
