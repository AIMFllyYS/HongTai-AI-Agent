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
import com.hongtai.aiagent.production.CloudNarrationConfiguration
import com.hongtai.aiagent.production.CloudNarrationSynthesizer
import com.hongtai.aiagent.production.ProductionAssetKind
import com.hongtai.aiagent.production.ProductionException
import com.hongtai.aiagent.production.ProductionFailureKind
import com.hongtai.aiagent.production.ProductionImportSelection
import com.hongtai.aiagent.production.ProductionMediaStore
import com.hongtai.aiagent.production.ProductionPlanParser
import com.hongtai.aiagent.production.ProductionRenderMode
import com.hongtai.aiagent.production.ProductionRenderer
import com.hongtai.aiagent.production.SystemNarrationSynthesizer
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import com.hongtai.aiagent.storage.LocalPreferences
import java.util.concurrent.Executors

@UnstableApi
@CapacitorPlugin(name = "ProductionRuntime")
class ProductionRuntimePlugin : Plugin() {
  private val store by lazy { ProductionMediaStore(context) }
  private val renderer by lazy { ProductionRenderer(context, store) }
  private val preferences by lazy { LocalPreferences(context) }
  private val secrets by lazy { AndroidKeystoreSecretStore(context) }

  @PluginMethod
  fun pickAssets(call: PluginCall) {
    val projectId = call.getString("projectId")
    val maxItems = call.getInt("maxItems", 12) ?: 12
    val selection = importSelection(call.getString("selection"))
    if (projectId.isNullOrBlank() || maxItems !in 1..12 || selection == null || selection == ProductionImportSelection.AVATAR && maxItems != 1) {
      call.reject("projectId or maxItems is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType(if (selection == ProductionImportSelection.AVATAR) "video/mp4" else "*/*")
      .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, selection == ProductionImportSelection.VISUAL)
      .putExtra(Intent.EXTRA_MIME_TYPES, if (selection == ProductionImportSelection.AVATAR) AVATAR_MIME_TYPES else SUPPORTED_MIME_TYPES)
    startActivityForResult(call, intent, "onAssetsPicked")
  }

  @ActivityCallback
  private fun onAssetsPicked(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      call.reject("Production asset selection was cancelled.", NativeIssueCode.MEDIA_SELECTION_CANCELLED)
      return
    }
    val uris = buildList {
      result.data?.clipData?.let { clips -> repeat(clips.itemCount) { add(clips.getItemAt(it).uri) } }
      if (isEmpty()) result.data?.data?.let(::add)
    }.distinct()
    val projectId = requireNotNull(call.getString("projectId"))
    val maxItems = call.getInt("maxItems", 12) ?: 12
    val selection = importSelection(call.getString("selection"))
    if (selection == null || uris.isEmpty() || uris.size > maxItems || selection == ProductionImportSelection.AVATAR && uris.size != 1) {
      call.reject("The selected production asset count is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val assets = store.importAll(projectId, uris, selection)
        call.resolve(JSObject().put("assets", JSArray(assets.map(::assetJson))))
      } catch (error: ProductionException) {
        call.reject(error.message ?: "The selected production asset is invalid.", nativeIssueCode(error.kind))
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "The selected production asset is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      } catch (error: Exception) {
        call.reject("Could not import the selected production assets.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      }
    }
  }

  @PluginMethod
  fun render(call: PluginCall) {
    val projectId = call.getString("projectId")
    val planJson = call.getString("planJson")
    val mode = renderMode(call.getString("mode"))
    val narration = narrationMode(call.getString("narration"))
    if (projectId.isNullOrBlank() || planJson.isNullOrBlank() || mode == null || narration == null) {
      call.reject("projectId and planJson are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val plan = ProductionPlanParser.parse(planJson, store.inputs(projectId), mode)
        val synthesizer = when {
          mode == ProductionRenderMode.MONTAGE && narration == ProductionNarrationMode.PROVIDER -> CloudNarrationSynthesizer(
            context,
            store,
            CloudNarrationConfiguration.from(preferences.readAiConnection()),
            secrets,
          )
          else -> SystemNarrationSynthesizer(context, store)
        }
        val output = renderer.render(projectId, plan, synthesizer) { progress, message ->
          notifyListeners("productionProgress", JSObject().put("projectId", projectId).put("progress", progress).put("message", message))
        }
        call.resolve(
          JSObject().put("uri", output.uri).put("mimeType", "video/mp4")
            .put("sizeBytes", output.sizeBytes).put("durationSeconds", output.durationSeconds),
        )
      } catch (error: ProductionException) {
        call.reject(error.message ?: "The local production render failed.", nativeIssueCode(error.kind))
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "The production plan is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      } catch (error: Exception) {
        call.reject("The local production render failed.", NativeIssueCode.MEDIA_MERGE_FAILED)
      }
    }
  }

  @PluginMethod
  fun probeTts(call: PluginCall) {
    PRODUCTION_EXECUTOR.execute {
      try {
        CloudNarrationSynthesizer(
          context,
          store,
          CloudNarrationConfiguration.from(preferences.readAiConnection()),
          secrets,
        ).probe()
        call.resolve()
      } catch (error: ProductionException) {
        call.reject(error.message ?: "Cloud TTS is unavailable.", nativeIssueCode(error.kind))
      } catch (error: IllegalArgumentException) {
        call.reject("Cloud TTS is unavailable.", NativeIssueCode.TTS_UNAVAILABLE)
      } catch (error: Exception) {
        call.reject("Cloud TTS probe failed.", NativeIssueCode.TTS_SYNTHESIS_FAILED)
      }
    }
  }

  private fun assetJson(asset: ImportedProductionAsset): JSObject = JSObject()
    .put("id", asset.id).put("uri", asset.uri).put("kind", asset.kind.name.lowercase())
    .put("role", asset.role.name.lowercase())
    .put("mimeType", asset.mimeType).put("displayName", asset.displayName).put("sizeBytes", asset.sizeBytes)
    .also { if (asset.durationSeconds != null) it.put("durationSeconds", asset.durationSeconds) }

  private fun importSelection(value: String?): ProductionImportSelection? = when (value ?: "visual") {
    "visual" -> ProductionImportSelection.VISUAL
    "avatar" -> ProductionImportSelection.AVATAR
    else -> null
  }

  private fun renderMode(value: String?): ProductionRenderMode? = when (value ?: "montage") {
    "montage" -> ProductionRenderMode.MONTAGE
    "avatar" -> ProductionRenderMode.AVATAR
    else -> null
  }

  private fun narrationMode(value: String?): ProductionNarrationMode? = when (value ?: "system") {
    "system" -> ProductionNarrationMode.SYSTEM
    "provider" -> ProductionNarrationMode.PROVIDER
    else -> null
  }

  private fun nativeIssueCode(kind: ProductionFailureKind): String = when (kind) {
    ProductionFailureKind.MEDIA_SOURCE_INVALID -> NativeIssueCode.MEDIA_SOURCE_INVALID
    ProductionFailureKind.TTS_UNAVAILABLE -> NativeIssueCode.TTS_UNAVAILABLE
    ProductionFailureKind.TTS_SYNTHESIS_FAILED -> NativeIssueCode.TTS_SYNTHESIS_FAILED
    ProductionFailureKind.MEDIA_RENDER_TIMEOUT -> NativeIssueCode.MEDIA_RENDER_TIMEOUT
    ProductionFailureKind.MEDIA_EXPORT_FAILED -> NativeIssueCode.MEDIA_EXPORT_FAILED
    ProductionFailureKind.OUTPUT_FINALIZATION_FAILED -> NativeIssueCode.OUTPUT_FINALIZATION_FAILED
  }

  private companion object {
    val SUPPORTED_MIME_TYPES = arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mpeg", "audio/mp4", "audio/wav")
    val AVATAR_MIME_TYPES = arrayOf("video/mp4")
    val PRODUCTION_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-video-production").apply { isDaemon = true }
    }
  }

  private enum class ProductionNarrationMode {
    SYSTEM,
    PROVIDER,
  }
}
