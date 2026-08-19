package com.hongtai.aiagent.bridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.media3.common.util.UnstableApi
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.production.AssetOperationAwaitingResult
import com.hongtai.aiagent.production.AssetOperationFailed
import com.hongtai.aiagent.production.AssetOperationImporting
import com.hongtai.aiagent.production.AssetOperationStateStore
import com.hongtai.aiagent.production.AssetOperationSucceeded
import com.hongtai.aiagent.production.AssetOperationTerminal
import com.hongtai.aiagent.production.AssetPickerResumePolicy
import com.hongtai.aiagent.production.ImportedProductionAsset
import com.hongtai.aiagent.production.CloudNarrationConfiguration
import com.hongtai.aiagent.production.CloudNarrationSynthesizer
import com.hongtai.aiagent.production.CloudTtsProtocol
import com.hongtai.aiagent.production.DecorationAssets
import com.hongtai.aiagent.production.ProductionException
import com.hongtai.aiagent.production.ProductionFailureKind
import com.hongtai.aiagent.production.ProductionImportSelection
import com.hongtai.aiagent.production.ProductionInsightFrames
import com.hongtai.aiagent.production.ProductionMediaStore
import com.hongtai.aiagent.production.ProductionPlanParser
import com.hongtai.aiagent.production.ProductionRenderMode
import com.hongtai.aiagent.production.ProductionRenderer
import com.hongtai.aiagent.production.SystemNarrationSynthesizer
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import com.hongtai.aiagent.storage.LocalPreferences
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

@UnstableApi
@CapacitorPlugin(name = "ProductionRuntime")
class ProductionRuntimePlugin : Plugin() {
  private val store by lazy { ProductionMediaStore(context) }
  private val renderer by lazy { ProductionRenderer(context, store) }
  private val insightFrames by lazy { ProductionInsightFrames(store) }
  private val preferences by lazy { LocalPreferences(context) }
  private val secrets by lazy { AndroidKeystoreSecretStore(context) }
  private val assetOperations by lazy { AssetOperationStateStore(context) }
  private val scheduledOperations = ConcurrentHashMap.newKeySet<String>()
  private var assetOriginalCall: PluginCall? = null
  private var assetRecoveryConsumerCall: PluginCall? = null

  override fun load() {
    super.load()
    resumePersistedAssetImport()
  }

  override fun handleOnResume() {
    super.handleOnResume()
    val awaiting = assetOperations.current() as? AssetOperationAwaitingResult ?: return
    if (!AssetPickerResumePolicy.shouldFailAwaitingPicker(isLiveOriginalCall(assetOriginalCall))) return
    finishAssetFailure(assetOriginalCall, awaiting.operationId, NativeIssueCode.ASSET_RECOVERY_FAILED)
  }

  @PluginMethod
  fun pickAssets(call: PluginCall) {
    val projectId = call.getString("projectId")
    val maxItems = call.getInt("maxItems", 12) ?: 12
    val selection = importSelection(call.getString("selection"))
    if (projectId.isNullOrBlank() || maxItems !in 1..12 || selection == null || selection == ProductionImportSelection.AVATAR && maxItems != 1) {
      call.reject("projectId or maxItems is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val operation = try {
      assetOperations.begin(projectId, maxItems, selection)
    } catch (error: Exception) {
      call.reject("Another asset operation must finish first.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    assetOriginalCall = call
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType(if (selection == ProductionImportSelection.AVATAR) "video/mp4" else "*/*")
      .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, selection == ProductionImportSelection.VISUAL)
      .putExtra(Intent.EXTRA_MIME_TYPES, if (selection == ProductionImportSelection.AVATAR) AVATAR_MIME_TYPES else SUPPORTED_MIME_TYPES)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    try {
      startActivityForResult(call, intent, "onAssetsPicked")
    } catch (_: ActivityNotFoundException) {
      finishAssetFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
    } catch (_: Exception) {
      finishAssetFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
    }
  }

  @ActivityCallback
  private fun onAssetsPicked(call: PluginCall?, result: ActivityResult) {
    val operation = assetOperations.current() as? AssetOperationAwaitingResult
    if (operation == null) {
      finishOrphanedAssetFailure(call, NativeIssueCode.ASSET_RECOVERY_FAILED)
      return
    }
    if (result.resultCode != Activity.RESULT_OK) {
      finishAssetFailure(call, operation.operationId, NativeIssueCode.MEDIA_SELECTION_CANCELLED)
      return
    }
    val uris = buildList {
      result.data?.clipData?.let { clips -> repeat(clips.itemCount) { add(clips.getItemAt(it).uri) } }
      if (isEmpty()) result.data?.data?.let(::add)
    }.distinct()
    if (uris.isEmpty() || uris.size > operation.maxItems || operation.selection == ProductionImportSelection.AVATAR && uris.size != 1) {
      finishAssetFailure(call, operation.operationId, if (uris.isEmpty()) NativeIssueCode.MEDIA_SOURCE_MISSING else NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    try {
      uris.forEach(::persistPickerReadPermission)
    } catch (_: AssetOperationImportException) {
      uris.forEach { releasePickerReadPermission(it.toString()) }
      finishAssetFailure(call, operation.operationId, NativeIssueCode.MEDIA_READ_FAILED)
      return
    }
    val importing = assetOperations.markImporting(operation.operationId, uris.map(Uri::toString))
    if (importing == null) {
      uris.forEach { releasePickerReadPermission(it.toString()) }
      finishAssetFailure(call, operation.operationId, NativeIssueCode.ASSET_RECOVERY_FAILED)
      return
    }
    submitAssetImport(call, importing)
  }

  @PluginMethod
  fun consumeAssetOperation(call: PluginCall) {
    when (val state = assetOperations.current()) {
      null -> call.resolve(JSObject().put("status", "none"))
      is AssetOperationTerminal -> {
        val terminal = assetOperations.consumeTerminal()
        if (terminal == null) call.reject("Could not consume the recovered asset operation.", NativeIssueCode.ASSET_RECOVERY_FAILED)
        else call.resolve(assetRecoveryResult(terminal))
      }
      else -> {
        if (isLiveOriginalCall(assetOriginalCall)) {
          call.resolve(JSObject().put("status", "none"))
          return
        }
        if (assetRecoveryConsumerCall != null) {
          call.reject("An asset recovery consumer is already waiting.", NativeIssueCode.INVALID_ARGUMENT)
          return
        }
        assetRecoveryConsumerCall = call
        if (state is AssetOperationImporting) resumePersistedAssetImport()
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
    val cloudInstructions = if (mode == ProductionRenderMode.MONTAGE && narration == ProductionNarrationMode.PROVIDER) {
      requiredCloudTtsInstructions(call) ?: return
    } else {
      null
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val plan = ProductionPlanParser.parse(
          planJson,
          store.inputs(projectId),
          mode,
          call.getString("subtitleTemplateJson"),
          stickerExists = { id -> DecorationAssets.exists(context.assets, id) },
        )
        val synthesizer = if (cloudInstructions != null) {
          CloudNarrationSynthesizer(
            context,
            store,
            CloudNarrationConfiguration.from(preferences.readAiConnection()),
            cloudInstructions.first,
            cloudInstructions.second,
            secrets,
          )
        } else {
          SystemNarrationSynthesizer(context, store)
        }
        val output = renderer.render(projectId, plan, synthesizer) { progress, stage ->
          notifyListeners("productionProgress", JSObject().put("projectId", projectId).put("progress", progress).put("stage", stage))
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

  /**
   * Publishes bounded JPEG derivatives of one asset for the vision model.
   *
   * Resolves with an empty list rather than rejecting when there is nothing to look at: an asset
   * that cannot be sampled leaves the plan honestly marked as matched blind, and refusing here would
   * block an export the renderer can produce without ever seeing the picture.
   */
  @PluginMethod
  fun insightFrames(call: PluginCall) {
    val projectId = call.getString("projectId")
    val assetId = call.getString("assetId")
    if (projectId.isNullOrBlank() || assetId.isNullOrBlank()) {
      call.reject("projectId and assetId are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    PRODUCTION_EXECUTOR.execute {
      try {
        val frames = insightFrames.frames(projectId, assetId)
        val array = JSArray()
        frames.forEach { frame -> array.put(JSObject().put("uri", frame.uri).put("mimeType", frame.mimeType)) }
        call.resolve(JSObject().put("frames", array))
      } catch (error: IllegalArgumentException) {
        call.reject(error.message ?: "The production asset reference is invalid.", NativeIssueCode.INVALID_ARGUMENT)
      } catch (error: ProductionException) {
        call.reject(error.message ?: "The production asset could not be read.", nativeIssueCode(error.kind))
      } catch (error: Exception) {
        call.reject("The production asset frames could not be prepared.", NativeIssueCode.MEDIA_SOURCE_INVALID)
      }
    }
  }

  @PluginMethod
  fun probeTts(call: PluginCall) {
    val instructions = requiredCloudTtsInstructions(call) ?: return
    PRODUCTION_EXECUTOR.execute {
      try {
        CloudNarrationSynthesizer(
          context,
          store,
          CloudNarrationConfiguration.from(preferences.readAiConnection()),
          instructions.first,
          instructions.second,
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

  private fun resumePersistedAssetImport() {
    val importing = assetOperations.current() as? AssetOperationImporting ?: return
    submitAssetImport(null, importing)
  }

  private fun submitAssetImport(call: PluginCall?, operation: AssetOperationImporting) {
    if (!scheduledOperations.add(operation.operationId)) return
    try {
      PRODUCTION_EXECUTOR.execute {
        try {
          val uris = operation.sourceUris.map(Uri::parse)
          val assets = store.importAll(operation.projectId, uris, operation.selection)
          val terminal = assetOperations.complete(operation.operationId, assets)
            ?: assetOperations.current() as? AssetOperationTerminal
          terminal?.let { finishAssetTerminal(call, it) }
        } catch (error: Exception) {
          finishAssetFailure(call, operation.operationId, assetNativeCodeFor(error))
        } finally {
          operation.sourceUris.forEach(::releasePickerReadPermission)
          scheduledOperations.remove(operation.operationId)
        }
      }
    } catch (_: RejectedExecutionException) {
      scheduledOperations.remove(operation.operationId)
      finishAssetFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
    }
  }

  private fun persistPickerReadPermission(sourceUri: Uri) {
    try {
      context.contentResolver.takePersistableUriPermission(sourceUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      throw AssetOperationImportException(NativeIssueCode.MEDIA_READ_FAILED)
    } catch (_: IllegalArgumentException) {
      throw AssetOperationImportException(NativeIssueCode.MEDIA_READ_FAILED)
    }
  }

  private fun releasePickerReadPermission(sourceUri: String?) {
    val uri = sourceUri?.let(Uri::parse) ?: return
    try {
      context.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      // The permission can be absent after an interrupted import; the terminal state is already persisted.
    } catch (_: IllegalArgumentException) {
      // A malformed persisted URI cannot be released and must not block terminal cleanup.
    }
  }

  private fun finishOrphanedAssetFailure(call: PluginCall?, code: String) {
    val terminal = assetOperations.failOrphaned(code) ?: assetOperations.current() as? AssetOperationTerminal
    terminal?.let { finishAssetTerminal(call, it) }
  }

  private fun finishAssetFailure(call: PluginCall?, operationId: String, code: String) {
    val terminal = assetOperations.fail(operationId, code) ?: assetOperations.current() as? AssetOperationTerminal
    terminal?.let { finishAssetTerminal(call, it) }
  }

  private fun finishAssetTerminal(call: PluginCall?, terminal: AssetOperationTerminal) {
    assetOriginalCall = null
    if (call != null && isLiveOriginalCall(call)) {
      val consumed = assetOperations.consumeTerminal() ?: return
      when (consumed) {
        is AssetOperationSucceeded -> call.resolve(JSObject().put("assets", JSArray(consumed.assets.map(::assetJson))))
        is AssetOperationFailed -> if (consumed.code == NativeIssueCode.MEDIA_SELECTION_CANCELLED) {
          call.reject("Production asset selection was cancelled.", NativeIssueCode.MEDIA_SELECTION_CANCELLED)
        } else {
          call.reject(assetMessageFor(consumed.code), consumed.code)
        }
      }
      return
    }
    deliverRecoveredAssetTerminal()
  }

  private fun deliverRecoveredAssetTerminal() {
    val consumer = assetRecoveryConsumerCall ?: return
    val terminal = assetOperations.consumeTerminal() ?: return
    assetRecoveryConsumerCall = null
    consumer.resolve(assetRecoveryResult(terminal))
  }

  private fun isLiveOriginalCall(call: PluginCall?): Boolean = call != null &&
    call.callbackId != PluginCall.CALLBACK_ID_DANGLING

  private fun assetNativeCodeFor(error: Exception): String = when (error) {
    is AssetOperationImportException -> error.nativeCode
    is ProductionException -> nativeIssueCode(error.kind)
    is IllegalArgumentException -> NativeIssueCode.INVALID_ARGUMENT
    else -> NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED
  }

  private fun assetMessageFor(code: String): String = when (code) {
    NativeIssueCode.MEDIA_SELECTION_CANCELLED -> "Production asset selection was cancelled."
    NativeIssueCode.MEDIA_SOURCE_MISSING -> "The selected production asset did not provide a URI."
    NativeIssueCode.ASSET_RECOVERY_FAILED -> "The asset operation could not be recovered."
    NativeIssueCode.MEDIA_READ_FAILED -> "The selected production asset could not be read."
    NativeIssueCode.INVALID_ARGUMENT -> "The selected production asset count is invalid."
    NativeIssueCode.MEDIA_SOURCE_INVALID -> "The selected production asset is invalid."
    else -> "Could not import the selected production assets."
  }

  private fun assetRecoveryResult(terminal: AssetOperationTerminal): JSObject = when (terminal) {
    is AssetOperationSucceeded -> JSObject()
      .put("status", "succeeded")
      .put("projectId", terminal.projectId)
      .put("assets", JSArray(terminal.assets.map(::assetJson)))
    is AssetOperationFailed -> JSObject()
      .put("status", "failed")
      .put("code", terminal.code)
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

  private fun requiredCloudTtsInstructions(call: PluginCall): Pair<String, String>? = try {
    CloudTtsProtocol.requireInstruction(call.getString("miMoInstruction")) to
      CloudTtsProtocol.requireInstruction(call.getString("stepFunInstruction"))
  } catch (error: IllegalArgumentException) {
    call.reject(error.message ?: "TTS instruction is required.", NativeIssueCode.INVALID_ARGUMENT)
    null
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
    ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE -> NativeIssueCode.MEDIA_ENCODER_UNAVAILABLE
    ProductionFailureKind.MEDIA_DECODE_FAILED -> NativeIssueCode.MEDIA_DECODE_FAILED
    ProductionFailureKind.MEDIA_RENDER_PIPELINE_FAILED -> NativeIssueCode.MEDIA_RENDER_PIPELINE_FAILED
    ProductionFailureKind.MEDIA_OUTPUT_INVALID -> NativeIssueCode.MEDIA_OUTPUT_INVALID
    ProductionFailureKind.MEDIA_EXPORT_FAILED -> NativeIssueCode.MEDIA_EXPORT_FAILED
    ProductionFailureKind.OUTPUT_FINALIZATION_FAILED -> NativeIssueCode.OUTPUT_FINALIZATION_FAILED
    ProductionFailureKind.DECORATION_ASSET_MISSING -> NativeIssueCode.DECORATION_ASSET_MISSING
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

  private class AssetOperationImportException(val nativeCode: String) : IllegalStateException(nativeCode)
}
