package com.hongtai.aiagent.storage

/** Public local profile data stored in SharedPreferences for the standalone demo. */
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

/** Public OpenAI-compatible connection metadata. The API key remains in Keystore. */
data class LocalAiConnection(
  val connectionId: String,
  val baseUrl: String,
  val textModel: String,
  val visionModel: String?,
  val asrModel: String?,
  val asrTransport: String?,
  val ttsModel: String?,
  val ttsTransport: String?,
  val ttsVoice: String?,
  val jsonObjectEnabled: Boolean,
  val jsonSchemaEnabled: Boolean,
  /** Per-capability public probe outcome JSON. Never contains the API key. */
  val probeResultsJson: String = "[]",
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)
