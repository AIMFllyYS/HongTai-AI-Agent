package com.hongtai.aiagent.storage

/** Schema v1 is intentionally limited to implemented local capabilities. */
object SchemaV1 {
  const val version = 1
  const val migrationAssetPath = "migrations/V1__local_foundation.sql"

  val tableNames: Set<String> = setOf(
    "schema_migrations",
    "profiles",
    "ai_connections",
    "tasks",
    "task_events",
    "content_analyses",
    "diagnosis_sessions",
    "diagnosis_messages",
  )
}

data class LocalProfile(
  val localProfileId: String,
  val remoteAccountId: String?,
  val displayName: String,
  val avatarUri: String?,
  val businessName: String?,
  val industry: String?,
  val businessTagsJson: String,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)

data class LocalAiConnection(
  val connectionId: String,
  val baseUrl: String,
  val textModel: String,
  val visionModel: String?,
  val asrModel: String?,
  val asrTransport: String?,
  val jsonObjectEnabled: Boolean,
  val jsonSchemaEnabled: Boolean,
  /** Per-capability public probe outcome JSON. Never contains the API key. */
  val probeResultsJson: String = "[]",
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)
