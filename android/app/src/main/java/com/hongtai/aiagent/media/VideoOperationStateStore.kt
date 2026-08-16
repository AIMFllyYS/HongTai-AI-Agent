package com.hongtai.aiagent.media

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal sealed interface VideoOperationState {
  val operationId: String
  val taskId: String
  val startedAtEpochMs: Long
}

internal data class VideoOperationAwaitingResult(
  override val operationId: String,
  override val taskId: String,
  override val startedAtEpochMs: Long,
) : VideoOperationState

internal data class VideoOperationImporting(
  override val operationId: String,
  override val taskId: String,
  override val startedAtEpochMs: Long,
  val sourceUri: String,
) : VideoOperationState

internal sealed interface VideoOperationTerminal : VideoOperationState {
  val completedAtEpochMs: Long
}

internal data class VideoOperationSucceeded(
  override val operationId: String,
  override val taskId: String,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val uri: String,
  val mimeType: String,
  val displayName: String,
  val sizeBytes: Long,
  val durationSeconds: Double,
) : VideoOperationTerminal

internal data class VideoOperationFailed(
  override val operationId: String,
  override val taskId: String,
  override val startedAtEpochMs: Long,
  override val completedAtEpochMs: Long,
  val code: String,
) : VideoOperationTerminal

/**
 * Owns the one short-lived video picker operation that can cross an external
 * Activity or WebView recreation. It stores only control metadata and a
 * one-time terminal result; media bytes never enter preferences.
 */
internal class VideoOperationStateStore(
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
  fun begin(taskId: String): VideoOperationAwaitingResult {
    require(TASK_ID.matches(taskId)) { "Video operation taskId is invalid." }
    check(current() == null) { "Another video operation is already active." }
    return VideoOperationAwaitingResult(
      operationId = createOperationId(),
      taskId = taskId,
      startedAtEpochMs = nowEpochMs(),
    ).also(::persist)
  }

  @Synchronized
  fun markImporting(operationId: String, sourceUri: String): VideoOperationImporting? {
    require(sourceUri.isNotBlank()) { "Picker source URI is required." }
    val state = current()
    if (state is VideoOperationImporting && state.operationId == operationId) {
      return state.takeIf { it.sourceUri == sourceUri }
    }
    if (state !is VideoOperationAwaitingResult || state.operationId != operationId) return null
    return VideoOperationImporting(
      operationId = operationId,
      taskId = state.taskId,
      startedAtEpochMs = state.startedAtEpochMs,
      sourceUri = sourceUri,
    ).also(::persist)
  }

  @Synchronized
  fun complete(operationId: String, file: ImportedTaskVideo): VideoOperationSucceeded? {
    val state = current()
    if (state !is VideoOperationImporting || state.operationId != operationId) return null
    require(file.uri.isNotBlank() && file.mimeType == "video/mp4" && file.displayName.isNotBlank() && file.sizeBytes > 0L && file.durationSeconds > 0.0) {
      "Imported video result is invalid."
    }
    return VideoOperationSucceeded(
      operationId = operationId,
      taskId = state.taskId,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      uri = file.uri,
      mimeType = file.mimeType,
      displayName = file.displayName,
      sizeBytes = file.sizeBytes,
      durationSeconds = file.durationSeconds,
    ).also(::persist)
  }

  @Synchronized
  fun fail(operationId: String, code: String): VideoOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Video operation failure code is invalid." }
    val state = current()
    if (state == null || state is VideoOperationTerminal || state.operationId != operationId) return null
    return VideoOperationFailed(
      operationId = operationId,
      taskId = state.taskId,
      startedAtEpochMs = state.startedAtEpochMs,
      completedAtEpochMs = nowEpochMs(),
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun failOrphaned(code: String): VideoOperationFailed? {
    require(NATIVE_CODE.matches(code)) { "Video operation failure code is invalid." }
    if (current() != null) return null
    val timestamp = nowEpochMs()
    return VideoOperationFailed(
      operationId = createOperationId(),
      taskId = "orphaned-video",
      startedAtEpochMs = timestamp,
      completedAtEpochMs = timestamp,
      code = code,
    ).also(::persist)
  }

  @Synchronized
  fun current(): VideoOperationState? = readPersisted()?.let(::decode)

  @Synchronized
  fun consumeTerminal(): VideoOperationTerminal? {
    val terminal = current() as? VideoOperationTerminal ?: return null
    writePersisted(null)
    return terminal
  }

  private fun persist(state: VideoOperationState) {
    writePersisted(encode(state).toString())
  }

  private fun encode(state: VideoOperationState): JSONObject = JSONObject()
    .put("operationId", state.operationId)
    .put("taskId", state.taskId)
    .put("startedAtEpochMs", state.startedAtEpochMs)
    .also { value ->
      when (state) {
        is VideoOperationAwaitingResult -> value.put("phase", "awaiting_result")
        is VideoOperationImporting -> value.put("phase", "importing").put("sourceUri", state.sourceUri)
        is VideoOperationSucceeded -> value.put("phase", "succeeded")
          .put("completedAtEpochMs", state.completedAtEpochMs)
          .put("uri", state.uri)
          .put("mimeType", state.mimeType)
          .put("displayName", state.displayName)
          .put("sizeBytes", state.sizeBytes)
          .put("durationSeconds", state.durationSeconds)
        is VideoOperationFailed -> value.put("phase", "failed")
          .put("completedAtEpochMs", state.completedAtEpochMs)
          .put("code", state.code)
      }
    }

  private fun decode(raw: String): VideoOperationState? {
    return try {
      val value = JSONObject(raw)
      val operationId = value.getString("operationId").takeIf { OPERATION_ID.matches(it) } ?: return null
      val taskId = value.getString("taskId").takeIf { TASK_ID.matches(it) } ?: return null
      val startedAt = value.getLong("startedAtEpochMs").takeIf { it >= 0L } ?: return null
      when (value.getString("phase")) {
        "awaiting_result" -> VideoOperationAwaitingResult(operationId, taskId, startedAt)
        "importing" -> {
          val sourceUri = value.optString("sourceUri").takeIf { it.isNotBlank() } ?: return null
          VideoOperationImporting(operationId, taskId, startedAt, sourceUri)
        }
        "succeeded" -> VideoOperationSucceeded(
          operationId = operationId,
          taskId = taskId,
          startedAtEpochMs = startedAt,
          completedAtEpochMs = value.getLong("completedAtEpochMs"),
          uri = value.getString("uri"),
          mimeType = value.getString("mimeType"),
          displayName = value.getString("displayName"),
          sizeBytes = value.getLong("sizeBytes"),
          durationSeconds = value.getDouble("durationSeconds"),
        )
        "failed" -> VideoOperationFailed(
          operationId = operationId,
          taskId = taskId,
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
    const val PREFERENCES_NAME = "hongtai.video-operation"
    const val STATE_KEY = "active"
    val NATIVE_CODE = Regex("ERR_[A-Z0-9_]{2,116}")
    val OPERATION_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
    val TASK_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")

    fun preferences(context: Context) = context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun persistedReader(context: Context): () -> String? = {
      preferences(context).getString(STATE_KEY, null)
    }

    fun persistedWriter(context: Context): (String?) -> Unit = { value ->
      val editor = preferences(context).edit()
      if (value == null) editor.remove(STATE_KEY) else editor.putString(STATE_KEY, value)
      check(editor.commit()) { "Could not persist the active video operation." }
    }
  }
}
