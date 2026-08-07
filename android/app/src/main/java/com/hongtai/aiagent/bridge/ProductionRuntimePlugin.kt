package com.hongtai.aiagent.bridge

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.media3.common.util.UnstableApi
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.production.ImportedProductionAsset
import com.hongtai.aiagent.production.ProductionAssetKind
import com.hongtai.aiagent.production.ProductionMediaStore
import com.hongtai.aiagent.production.ProductionPlanParser
import com.hongtai.aiagent.production.ProductionRenderer
import java.util.concurrent.Executors

@UnstableApi
@CapacitorPlugin(name = "ProductionRuntime")
class ProductionRuntimePlugin : Plugin() {
  private val store by lazy { ProductionMediaStore(context) }
  private val renderer by lazy { ProductionRenderer(context, store) }

  @PluginMethod
  fun pickAssets(call: PluginCall) {
    val projectId = call.getString("projectId")
    val maxItems = call.getInt("maxItems", 12) ?: 12
    if (projectId.isNullOrBlank() || maxItems !in 1..12) {
      call.reject("projectId or maxItems is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("*/*")
      .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      .putExtra(Intent.EXTRA_MIME_TYPES, SUPPORTED_MIME_TYPES)
    startActivityForResult(call, intent, "onAssetsPicked")
  }

  @ActivityCallback
  private fun onAssetsPicked(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      call.reject("No production assets were selected.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    val uris = buildList {
      result.data?.clipData?.let { clips -> repeat(clips.itemCount) { add(clips.getItemAt(it).uri) } }
      if (isEmpty()) result.data?.data?.let(::add)
    }.distinct()
    val projectId = requireNotNull(call.getString("projectId"))
    val maxItems = call.getInt("maxItems", 12) ?: 12
    if (uris.isEmpty() || uris.size > maxItems) {
      call.reject("The selected production asset count is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val assets = store.importAll(projectId, uris)
        call.resolve(JSObject().put("assets", JSArray(assets.map(::assetJson))))
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "The selected production asset is invalid.", NativeIssueCode.INVALID_ARGUMENT, error)
      } catch (error: Exception) {
        call.reject("Could not import the selected production assets.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      }
    }
  }

  @PluginMethod
  fun render(call: PluginCall) {
    val projectId = call.getString("projectId")
    val planJson = call.getString("planJson")
    if (projectId.isNullOrBlank() || planJson.isNullOrBlank()) {
      call.reject("projectId and planJson are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val plan = ProductionPlanParser.parse(planJson, store.inputs(projectId))
        val output = renderer.render(projectId, plan) { progress, message ->
          notifyListeners("productionProgress", JSObject().put("projectId", projectId).put("progress", progress).put("message", message))
        }
        call.resolve(
          JSObject().put("uri", output.uri).put("mimeType", "video/mp4")
            .put("sizeBytes", output.sizeBytes).put("durationSeconds", output.durationSeconds),
        )
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "The production plan is invalid.", NativeIssueCode.INVALID_ARGUMENT, error)
      } catch (error: Exception) {
        call.reject("The local production render failed.", NativeIssueCode.MEDIA_MERGE_FAILED, error)
      }
    }
  }

  private fun assetJson(asset: ImportedProductionAsset): JSObject = JSObject()
    .put("id", asset.id).put("uri", asset.uri).put("kind", asset.kind.name.lowercase())
    .put("mimeType", asset.mimeType).put("displayName", asset.displayName).put("sizeBytes", asset.sizeBytes)
    .also { if (asset.durationSeconds != null) it.put("durationSeconds", asset.durationSeconds) }

  private companion object {
    val SUPPORTED_MIME_TYPES = arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mpeg", "audio/mp4", "audio/wav")
    val PRODUCTION_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-video-production").apply { isDaemon = true }
    }
  }
}
