package com.hongtai.aiagent.storage

import com.hongtai.aiagent.runtime.PersistedTaskState
import com.hongtai.aiagent.runtime.RuntimeTaskStatus
import com.hongtai.aiagent.runtime.TaskRecoveryStore
import java.util.UUID

/**
 * Real repository implementation over the encrypted SQLCipher connection.
 * It contains only local v1 records; no unimplemented feature table or mock
 * persistence path is available.
 */
class SqlCipherLocalStore(
  private val connection: SqlCipherConnection,
  private val migration: SqlCipherMigration,
) : LocalProfileRepository, LocalAiConnectionRepository, TaskRecoveryStore, EncryptedSchemaMigrator, AutoCloseable {
  override fun migrateToLatest(): Int {
    migration.apply(connection)
    return SchemaV1.version
  }

  override fun read(): LocalProfile? = connection.query(
    """
      SELECT local_profile_id, remote_account_id, display_name, avatar_uri,
             business_name, industry, business_tags_json,
             created_at_epoch_ms, updated_at_epoch_ms
      FROM profiles
      WHERE local_profile_id = ?
    """.trimIndent(),
    listOf(LOCAL_PROFILE_ID),
  ).firstOrNull()?.toLocalProfile()

  override fun save(profile: LocalProfile) {
    require(profile.displayName.isNotBlank()) { "displayName is required." }
    val localProfile = profile.copy(localProfileId = LOCAL_PROFILE_ID)
    connection.execute(
      """
        INSERT INTO profiles(
          local_profile_id, remote_account_id, display_name, avatar_uri,
          business_name, industry, business_tags_json,
          created_at_epoch_ms, updated_at_epoch_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(local_profile_id) DO UPDATE SET
          remote_account_id = excluded.remote_account_id,
          display_name = excluded.display_name,
          avatar_uri = excluded.avatar_uri,
          business_name = excluded.business_name,
          industry = excluded.industry,
          business_tags_json = excluded.business_tags_json,
          updated_at_epoch_ms = excluded.updated_at_epoch_ms
      """.trimIndent(),
      listOf(
        localProfile.localProfileId,
        localProfile.remoteAccountId,
        localProfile.displayName,
        localProfile.avatarUri,
        localProfile.businessName,
        localProfile.industry,
        localProfile.businessTagsJson,
        localProfile.createdAtEpochMs,
        localProfile.updatedAtEpochMs,
      ),
    )
  }

  override fun readAiConnection(): LocalAiConnection? = connection.query(
    """
      SELECT connection_id, base_url, text_model, vision_model, asr_model,
             asr_transport, json_object_enabled, json_schema_enabled,
             probe_results_json,
             created_at_epoch_ms, updated_at_epoch_ms
      FROM ai_connections
      WHERE connection_id = ?
    """.trimIndent(),
    listOf(ACTIVE_AI_CONNECTION_ID),
  ).firstOrNull()?.toLocalAiConnection()

  override fun saveAiConnection(connection: LocalAiConnection) {
    require(connection.baseUrl.isNotBlank()) { "baseUrl is required." }
    require(connection.textModel.isNotBlank()) { "textModel is required." }
    val activeConnection = connection.copy(connectionId = ACTIVE_AI_CONNECTION_ID)
    this.connection.execute(
      """
        INSERT INTO ai_connections(
          connection_id, base_url, text_model, vision_model, asr_model,
          asr_transport, json_object_enabled, json_schema_enabled, probe_results_json,
          created_at_epoch_ms, updated_at_epoch_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          base_url = excluded.base_url,
          text_model = excluded.text_model,
          vision_model = excluded.vision_model,
          asr_model = excluded.asr_model,
          asr_transport = excluded.asr_transport,
          json_object_enabled = excluded.json_object_enabled,
          json_schema_enabled = excluded.json_schema_enabled,
          probe_results_json = excluded.probe_results_json,
          updated_at_epoch_ms = excluded.updated_at_epoch_ms
      """.trimIndent(),
      listOf(
        activeConnection.connectionId,
        activeConnection.baseUrl,
        activeConnection.textModel,
        activeConnection.visionModel,
        activeConnection.asrModel,
        activeConnection.asrTransport,
        if (activeConnection.jsonObjectEnabled) 1 else 0,
        if (activeConnection.jsonSchemaEnabled) 1 else 0,
        activeConnection.probeResultsJson,
        activeConnection.createdAtEpochMs,
        activeConnection.updatedAtEpochMs,
      ),
    )
  }

  override fun listTaskStatesForRecovery(): List<PersistedTaskState> = connection.query(
    "SELECT id, status FROM tasks WHERE status IN (?, ?)",
    listOf("queued", "running"),
  ).map { row ->
    val taskId = row.requiredString("id")
    val status = when (row.requiredString("status")) {
      "queued" -> RuntimeTaskStatus.QUEUED
      "running" -> RuntimeTaskStatus.RUNNING
      else -> throw LocalStorageException(
        LocalStorageErrorCode.DATA_CORRUPTED,
        "A recoverable task has an unknown status.",
      )
    }
    PersistedTaskState(taskId, status)
  }

  override fun markInterrupted(taskId: String, interruptedAtEpochMs: Long): Boolean = connection.transaction {
      val changedRows = connection.executeWithChanges(
        """
          UPDATE tasks
          SET status = ?, updated_at_epoch_ms = ?
          WHERE id = ? AND status IN (?, ?)
        """.trimIndent(),
        listOf("interrupted", interruptedAtEpochMs, taskId, "queued", "running"),
      )
      if (changedRows == 0) return@transaction false
      if (changedRows != 1) {
        throw LocalStorageException(
          LocalStorageErrorCode.DATA_CORRUPTED,
          "Task recovery changed an unexpected number of rows.",
        )
      }

      val nextSequence = connection.query(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM task_events WHERE task_id = ?",
        listOf(taskId),
      ).firstOrNull()?.requiredLong("next_sequence") ?: 1L
      connection.execute(
        """
          INSERT INTO task_events(
            id, task_id, sequence, stage, status, message, progress,
            detail_json, issue_code, created_at_epoch_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """.trimIndent(),
        listOf(
          UUID.randomUUID().toString(),
          taskId,
          nextSequence,
          null,
          "interrupted",
          "Task was interrupted after the app stopped unexpectedly.",
          null,
          "{\"reason\":\"unclean-app-stop\"}",
          "TASK_INTERRUPTED",
          interruptedAtEpochMs,
        ),
      )
      true
    }

  override fun close() = connection.close()

  private fun Map<String, Any?>.toLocalProfile(): LocalProfile = LocalProfile(
    localProfileId = requiredString("local_profile_id"),
    remoteAccountId = this["remote_account_id"]?.toString(),
    displayName = requiredString("display_name"),
    avatarUri = this["avatar_uri"]?.toString(),
    businessName = this["business_name"]?.toString(),
    industry = this["industry"]?.toString(),
    businessTagsJson = requiredString("business_tags_json"),
    createdAtEpochMs = requiredLong("created_at_epoch_ms"),
    updatedAtEpochMs = requiredLong("updated_at_epoch_ms"),
  )

  private fun Map<String, Any?>.toLocalAiConnection(): LocalAiConnection = LocalAiConnection(
    connectionId = requiredString("connection_id"),
    baseUrl = requiredString("base_url"),
    textModel = requiredString("text_model"),
    visionModel = this["vision_model"]?.toString(),
    asrModel = this["asr_model"]?.toString(),
    asrTransport = this["asr_transport"]?.toString(),
    jsonObjectEnabled = requiredBoolean("json_object_enabled"),
    jsonSchemaEnabled = requiredBoolean("json_schema_enabled"),
    probeResultsJson = requiredString("probe_results_json"),
    createdAtEpochMs = requiredLong("created_at_epoch_ms"),
    updatedAtEpochMs = requiredLong("updated_at_epoch_ms"),
  )

  private fun Map<String, Any?>.requiredString(column: String): String = this[column]?.toString()
    ?: throw LocalStorageException(LocalStorageErrorCode.DATA_CORRUPTED, "Missing $column in local storage.")

  private fun Map<String, Any?>.requiredLong(column: String): Long = when (val value = this[column]) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull()
    else -> null
  } ?: throw LocalStorageException(LocalStorageErrorCode.DATA_CORRUPTED, "Invalid $column in local storage.")

  private fun Map<String, Any?>.requiredBoolean(column: String): Boolean = when (val value = this[column]) {
    is Boolean -> value
    is Number -> value.toInt() != 0
    is String -> when (value) {
      "1", "true" -> true
      "0", "false" -> false
      else -> null
    }
    else -> null
  } ?: throw LocalStorageException(LocalStorageErrorCode.DATA_CORRUPTED, "Invalid $column in local storage.")

  companion object {
    /** Stable records: this local-first app has no account switching or connection profiles in v1. */
    const val LOCAL_PROFILE_ID = "local"
    const val ACTIVE_AI_CONNECTION_ID = "active"
  }
}
