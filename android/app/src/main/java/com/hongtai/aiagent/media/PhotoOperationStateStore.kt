package com.hongtai.aiagent.media

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal enum class PhotoOperationKind {
  PICKER,
  CAPTURE,
}

internal sealed interface PhotoOperationState {
  val operationId: String
  val kind: PhotoOperationKind
  val startedAtEpochMs: Long
}

internal data class PhotoOperationAwaitingResult(
  override val operationId: String,
  override val kind: PhotoOperationKind,
  override val startedAtEpochMs: Long,
  val captureFileName: String? = null,
) : PhotoOperationState

internal data class PhotoOperationImporting(
  override val operationId: String,
  override val kind: PhotoOperationKind,
  override val startedAtEpochMs: Long,
  val sourceUri: String? = null,
  val captureFileName: String? = null,
) : PhotoOperationState

internal sealed interface PhotoOperationTerminal : PhotoOperationState {
  val completedAtEpochMs: Long
}

internal data class PhotoOperationSucceeded(
  override val operationId: String,
  override val kind: PhotoOperationKind,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val uri: String,
  val mimeType: String?,
  val sizeBytes: Long,
) : PhotoOperationTerminal

internal data class PhotoOperationFailed(
  override val operationId: String,
  override val kind: PhotoOperationKind,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val code: String,
) : PhotoOperationTerminal

/**
 * Owns the one short-lived photo operation that can cross an external
 * Activity or WebView recreation. It stores only control metadata and a
 * one-time terminal result; media bytes never enter preferences.
 */
internal class PhotoOperationStateStore(
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
  fun beginPicker(): PhotoOperationAwaitingResult = begin(PhotoOperationKind.PICKER)

  @Synchronized
  fun beginCapture(captureFileName: String): PhotoOperationAwaitingResult {
    require(isSafeLeafName(captureFileName)) { "Capture file name is invalid." }
    return begin(PhotoOperationKind.CAPTURE, captureFileName)
  }

  @Synchronized
  fun markPickerImporting(operationId: String, sourceUri: String): PhotoOperationImporting? {
    require(sourceUri.isNotBlank()) { "Picker source URI is required." }
    val state = current()
    if (state is PhotoOperationImporting && state.operationId == operationId && state.kind == PhotoOperationKind.PICKER) {
      return state.takeIf { it.sourceUri == sourceUri }
    }
    if (state !is PhotoOperationAwaitingResult || state.operationId != operationId || state.kind != PhotoOperationKind.PICKER) {
      return null
    }
    return PhotoOperationImporting(
      operationId = operationId,
      kind = state.kind,
      startedAtEpochMs = state.startedAtEpochMs,
      sourceUri = sourceUri,
    ).also(::persist)
  }

  @Synchronized
  fun markCaptureImporting(operationId: String): PhotoOperationImporting? {
    val state = current()
    if (state is PhotoOperationImporting && state.operationId == operationId && state.kind == PhotoOperationKind.CAPTURE) {
      return state
    }
    if (state !is PhotoOperationAwaitingResult || state.operationId != operationId || state.kind != PhotoOperationKind.CAPTURE || state.captureFileName == null) {
      return null
    }
    return PhotoOperationImporting(
      operationId = operationId,
      kind = state.kind,
      startedAtEpochMs = state.startedAtEpochMs,
      captureFileName = state.captureFileName,
    ).also(::persist)
  }

  @Synchronized
  fun complete(operationId: String, file: PrivateMediaFile): PhotoOperationSucceeded? {
    val state = current()
    if (state !is PhotoOperationImporting || state.operationId != operationId) return null
    require(file.uri.isNotBlank() && file.sizeBytes > 0L) { "Imported media result is invalid." }
    return PhotoOperationSucceeded(
      operationId = operationId,
      kind = state.kind,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      uri = file.uri,
      mimeType = file.mimeType,
      sizeBytes = file.sizeBytes,
    ).also(::persist)
  }

  @Synchronized
  fun fail(operationId: String, code: String): PhotoOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Photo operation failure code is invalid." }
    val state = current()
    if (state == null || state is PhotoOperationTerminal || state.operationId != operationId) return null
    return PhotoOperationFailed(
      operationId = operationId,
      kind = state.kind,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun failOrphaned(kind: PhotoOperationKind, code: String): PhotoOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Photo operation failure code is invalid." }
    if (current() != null) return null
    val timestamp = nowEpochMs()
    return PhotoOperationFailed(
      operationId = createOperationId(),
      kind = kind,
      startedAtEpochMs = timestamp,
      completedAtEpochMs = timestamp,
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun current(): PhotoOperationState? = readPersisted()?.let(::decode)

  @Synchronized
  fun consumeTerminal(): PhotoOperationTerminal? {
    val terminal = current() as? PhotoOperationTerminal ?: return null
    writePersisted(null)
    return terminal
  }

  private fun begin(kind: PhotoOperationKind, captureFileName: String? = null): PhotoOperationAwaitingResult {
    check(current() == null) { "Another photo operation is already active." }
    return PhotoOperationAwaitingResult(
      operationId = createOperationId(),
      kind = kind,
      startedAtEpochMs = nowEpochMs(),
      captureFileName = captureFileName,
    ).also(::persist)
  }

  private fun persist(state: PhotoOperationState) {
    writePersisted(encode(state).toString())
  }

  private fun encode(state: PhotoOperationState): JSONObject = JSONObject()
    .put("operationId", state.operationId)
    .put("kind", state.kind.name.lowercase())
    .put("startedAtEpochMs", state.startedAtEpochMs)
    .also { value ->
      when (state) {
        is PhotoOperationAwaitingResult -> {
          value.put("phase", "awaiting_result")
          state.captureFileName?.let { value.put("captureFileName", it) }
        }
        is PhotoOperationImporting -> {
          value.put("phase", "importing")
          state.sourceUri?.let { value.put("sourceUri", it) }
          state.captureFileName?.let { value.put("captureFileName", it) }
        }
        is PhotoOperationSucceeded -> value.put("phase", "succeeded")
          .put("completedAtEpochMs", state.completedAtEpochMs)
          .put("uri", state.uri)
          .put("mimeType", state.mimeType)
          .put("sizeBytes", state.sizeBytes)
        is PhotoOperationFailed -> value.put("phase", "failed")
          .put("completedAtEpochMs", state.completedAtEpochMs)
          .put("code", state.code)
      }
    }

  private fun decode(raw: String): PhotoOperationState? {
    return try {
      val value = JSONObject(raw)
      val operationId = value.getString("operationId").takeIf { OPERATION_ID.matches(it) } ?: return null
      val kind = when (value.getString("kind")) {
        "picker" -> PhotoOperationKind.PICKER
        "capture" -> PhotoOperationKind.CAPTURE
        else -> return null
      }
      val startedAt = value.getLong("startedAtEpochMs").takeIf { it >= 0L } ?: return null
      val captureFileName = value.optString("captureFileName").takeIf(::isSafeLeafName)
      when (value.getString("phase")) {
        "awaiting_result" -> PhotoOperationAwaitingResult(operationId, kind, startedAt, captureFileName)
        "importing" -> PhotoOperationImporting(
          operationId = operationId,
          kind = kind,
          startedAtEpochMs = startedAt,
          sourceUri = value.optString("sourceUri").takeIf { it.isNotBlank() },
          captureFileName = captureFileName,
        )
        "succeeded" -> PhotoOperationSucceeded(
          operationId = operationId,
          kind = kind,
          startedAtEpochMs = startedAt,
          completedAtEpochMs = value.getLong("completedAtEpochMs"),
          uri = value.getString("uri"),
          mimeType = value.optString("mimeType").takeIf { it.isNotBlank() && it != "null" },
          sizeBytes = value.getLong("sizeBytes"),
        )
        "failed" -> PhotoOperationFailed(
          operationId = operationId,
          kind = kind,
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
    const val PREFERENCES_NAME = "hongtai.photo-operation"
    const val STATE_KEY = "active"
    val NATIVE_CODE = Regex("ERR_[A-Z0-9_]{2,116}")
    val OPERATION_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")

    fun isSafeLeafName(value: String?): Boolean = !value.isNullOrBlank() &&
      value.length <= 120 && !value.contains('/') && !value.contains('\\') && !value.any(Char::isISOControl)

    fun preferences(context: Context) = context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun persistedReader(context: Context): () -> String? = {
      preferences(context).getString(STATE_KEY, null)
    }

    fun persistedWriter(context: Context): (String?) -> Unit = { value ->
      val editor = preferences(context).edit()
      if (value == null) editor.remove(STATE_KEY) else editor.putString(STATE_KEY, value)
      check(editor.commit()) { "Could not persist the active photo operation." }
    }
  }
}
