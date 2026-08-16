package com.hongtai.aiagent.production

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal sealed interface AssetOperationState {
  val operationId: String
  val projectId: String
  val maxItems: Int
  val selection: ProductionImportSelection
  val startedAtEpochMs: Long
}

internal data class AssetOperationAwaitingResult(
  override val operationId: String,
  override val projectId: String,
  override val maxItems: Int,
  override val selection: ProductionImportSelection,
  override val startedAtEpochMs: Long,
) : AssetOperationState

internal data class AssetOperationImporting(
  override val operationId: String,
  override val projectId: String,
  override val maxItems: Int,
  override val selection: ProductionImportSelection,
  override val startedAtEpochMs: Long,
  val sourceUris: List<String>,
) : AssetOperationState

internal sealed interface AssetOperationTerminal : AssetOperationState {
  val completedAtEpochMs: Long
}

internal data class AssetOperationSucceeded(
  override val operationId: String,
  override val projectId: String,
  override val maxItems: Int,
  override val selection: ProductionImportSelection,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val assets: List<ImportedProductionAsset>,
) : AssetOperationTerminal

internal data class AssetOperationFailed(
  override val operationId: String,
  override val projectId: String,
  override val maxItems: Int,
  override val selection: ProductionImportSelection,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val code: String,
) : AssetOperationTerminal

/**
 * Owns the one short-lived production-asset picker that can cross an external
 * Activity or WebView recreation. It stores only control metadata and a
 * one-time terminal result; media bytes never enter preferences.
 */
internal class AssetOperationStateStore(
  private val readPersisted: () -> String?,
  private val writePersisted: (String?) -> Unit,
  private val createOperationId: () -> String = { UUID.randomUUID().toString() },
  private val nowEpochMs: () -> Long = System::currentTimeMillis,
) {
  constructor(context: Context) : this(
    readPersisted = persistedReader(context),
    writePersisted = persistedWriter(context),
  )

  @Synchronized
  fun begin(projectId: String, maxItems: Int, selection: ProductionImportSelection): AssetOperationAwaitingResult {
    require(PROJECT_ID.matches(projectId)) { "Asset operation projectId is invalid." }
    require(maxItems in 1..12) { "Asset operation maxItems is invalid." }
    require(selection != ProductionImportSelection.AVATAR || maxItems == 1) { "Avatar import accepts one item." }
    check(current() == null) { "Another asset operation is already active." }
    return AssetOperationAwaitingResult(
      operationId = createOperationId(),
      projectId = projectId,
      maxItems = maxItems,
      selection = selection,
      startedAtEpochMs = nowEpochMs(),
    ).also(::persist)
  }

  @Synchronized
  fun markImporting(operationId: String, sourceUris: List<String>): AssetOperationImporting? {
    require(sourceUris.isNotEmpty() && sourceUris.all { it.isNotBlank() }) { "Picker source URIs are required." }
    val state = current()
    if (state is AssetOperationImporting && state.operationId == operationId) {
      return state.takeIf { it.sourceUris == sourceUris }
    }
    if (state !is AssetOperationAwaitingResult || state.operationId != operationId) return null
    if (sourceUris.size > state.maxItems || state.selection == ProductionImportSelection.AVATAR && sourceUris.size != 1) {
      return null
    }
    return AssetOperationImporting(
      operationId = operationId,
      projectId = state.projectId,
      maxItems = state.maxItems,
      selection = state.selection,
      startedAtEpochMs = state.startedAtEpochMs,
      sourceUris = sourceUris,
    ).also(::persist)
  }

  @Synchronized
  fun complete(operationId: String, assets: List<ImportedProductionAsset>): AssetOperationSucceeded? {
    val state = current()
    if (state !is AssetOperationImporting || state.operationId != operationId) return null
    require(assets.isNotEmpty() && assets.size <= state.maxItems) { "Imported asset result is invalid." }
    require(assets.all { it.id.isNotBlank() && it.uri.isNotBlank() && it.displayName.isNotBlank() && it.sizeBytes > 0L }) {
      "Imported asset result is invalid."
    }
    return AssetOperationSucceeded(
      operationId = operationId,
      projectId = state.projectId,
      maxItems = state.maxItems,
      selection = state.selection,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      assets = assets,
    ).also(::persist)
  }

  @Synchronized
  fun fail(operationId: String, code: String): AssetOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Asset operation failure code is invalid." }
    val state = current()
    if (state == null || state is AssetOperationTerminal || state.operationId != operationId) return null
    return AssetOperationFailed(
      operationId = operationId,
      projectId = state.projectId,
      maxItems = state.maxItems,
      selection = state.selection,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun failOrphaned(code: String): AssetOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Asset operation failure code is invalid." }
    if (current() != null) return null
    val timestamp = nowEpochMs()
    return AssetOperationFailed(
      operationId = createOperationId(),
      projectId = "orphaned-asset",
      maxItems = 1,
      selection = ProductionImportSelection.VISUAL,
      startedAtEpochMs = timestamp,
      completedAtEpochMs = timestamp,
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun current(): AssetOperationState? = readPersisted()?.let(::decode)

  @Synchronized
  fun consumeTerminal(): AssetOperationTerminal? {
    val terminal = current() as? AssetOperationTerminal ?: return null
    writePersisted(null)
    return terminal
  }

  private fun persist(state: AssetOperationState) {
    writePersisted(encode(state).toString())
  }

  private fun encode(state: AssetOperationState): JSONObject = JSONObject()
    .put("operationId", state.operationId)
    .put("projectId", state.projectId)
    .put("maxItems", state.maxItems)
    .put("selection", state.selection.name.lowercase())
    .put("startedAtEpochMs", state.startedAtEpochMs)
    .also { value ->
      when (state) {
        is AssetOperationAwaitingResult -> value.put("phase", "awaiting_result")
        is AssetOperationImporting -> {
          value.put("phase", "importing")
          value.put("sourceUris", JSONArray(state.sourceUris))
        }
        is AssetOperationSucceeded -> {
          value.put("phase", "succeeded")
          value.put("completedAtEpochMs", state.completedAtEpochMs)
          value.put("assets", JSONArray(state.assets.map(::encodeAsset)))
        }
        is AssetOperationFailed -> value.put("phase", "failed")
          .put("completedAtEpochMs", state.completedAtEpochMs)
          .put("code", state.code)
      }
    }

  private fun decode(raw: String): AssetOperationState? {
    return try {
      val value = JSONObject(raw)
      val operationId = value.getString("operationId").takeIf { OPERATION_ID.matches(it) } ?: return null
      val projectId = value.getString("projectId").takeIf { PROJECT_ID.matches(it) } ?: return null
      val maxItems = value.getInt("maxItems").takeIf { it in 1..12 } ?: return null
      val selection = when (value.getString("selection")) {
        "visual" -> ProductionImportSelection.VISUAL
        "avatar" -> ProductionImportSelection.AVATAR
        else -> return null
      }
      val startedAt = value.getLong("startedAtEpochMs").takeIf { it >= 0L } ?: return null
      when (value.getString("phase")) {
        "awaiting_result" -> AssetOperationAwaitingResult(operationId, projectId, maxItems, selection, startedAt)
        "importing" -> {
          val sourceUris = decodeStrings(value.optJSONArray("sourceUris"))
          if (sourceUris.isEmpty()) return null
          AssetOperationImporting(operationId, projectId, maxItems, selection, startedAt, sourceUris)
        }
        "succeeded" -> {
          val assets = decodeAssets(value.optJSONArray("assets"))
          if (assets.isEmpty()) return null
          AssetOperationSucceeded(
            operationId = operationId,
            projectId = projectId,
            maxItems = maxItems,
            selection = selection,
            startedAtEpochMs = startedAt,
            completedAtEpochMs = value.getLong("completedAtEpochMs"),
            assets = assets,
          )
        }
        "failed" -> AssetOperationFailed(
          operationId = operationId,
          projectId = projectId,
          maxItems = maxItems,
          selection = selection,
          startedAtEpochMs = startedAt,
          completedAtEpochMs = value.getLong("completedAtEpochMs"),
          code = value.getString("code").takeIf(NATIVE_CODE::matches) ?: return null,
        )
        else -> null
      }
    } catch (_: Exception) {
      null
    }
  }

  private companion object {
    const val PREFERENCES_NAME = "hongtai.asset-operation"
    const val STATE_KEY = "active"
    val NATIVE_CODE = Regex("ERR_[A-Z0-9_]{2,116}")
    val OPERATION_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
    val PROJECT_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")

    fun encodeAsset(asset: ImportedProductionAsset): JSONObject = JSONObject()
      .put("id", asset.id)
      .put("uri", asset.uri)
      .put("kind", asset.kind.name.lowercase())
      .put("role", asset.role.name.lowercase())
      .put("mimeType", asset.mimeType)
      .put("displayName", asset.displayName)
      .put("sizeBytes", asset.sizeBytes)
      .also { if (asset.durationSeconds != null) it.put("durationSeconds", asset.durationSeconds) }

    fun decodeAssets(raw: JSONArray?): List<ImportedProductionAsset> {
      if (raw == null) return emptyList()
      return buildList {
        for (index in 0 until raw.length()) {
          val item = raw.optJSONObject(index) ?: return emptyList()
          val kind = when (item.getString("kind")) {
            "image" -> ProductionAssetKind.IMAGE
            "video" -> ProductionAssetKind.VIDEO
            "audio" -> ProductionAssetKind.AUDIO
            else -> return emptyList()
          }
          val role = when (item.getString("role")) {
            "visual" -> ProductionAssetRole.VISUAL
            "avatar" -> ProductionAssetRole.AVATAR
            "music" -> ProductionAssetRole.MUSIC
            else -> return emptyList()
          }
          add(
            ImportedProductionAsset(
              id = item.getString("id"),
              uri = item.getString("uri"),
              kind = kind,
              role = role,
              mimeType = item.getString("mimeType"),
              displayName = item.getString("displayName"),
              sizeBytes = item.getLong("sizeBytes"),
              durationSeconds = if (item.has("durationSeconds")) item.getDouble("durationSeconds") else null,
            ),
          )
        }
      }
    }

    fun decodeStrings(raw: JSONArray?): List<String> {
      if (raw == null) return emptyList()
      return buildList {
        for (index in 0 until raw.length()) {
          val value = raw.optString(index).takeIf { it.isNotBlank() } ?: return emptyList()
          add(value)
        }
      }
    }

    fun preferences(context: Context) = context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun persistedReader(context: Context): () -> String? = {
      preferences(context).getString(STATE_KEY, null)
    }

    fun persistedWriter(context: Context): (String?) -> Unit = { value ->
      val editor = preferences(context).edit()
      if (value == null) editor.remove(STATE_KEY) else editor.putString(STATE_KEY, value)
      check(editor.commit()) { "Could not persist the active asset operation." }
    }
  }
}
