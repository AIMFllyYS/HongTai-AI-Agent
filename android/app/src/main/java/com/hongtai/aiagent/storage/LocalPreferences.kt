package com.hongtai.aiagent.storage

import android.content.Context
import android.content.SharedPreferences

/**
 * Small public local state for the standalone demo. It deliberately stores
 * only profile fields and OpenAI-compatible connection metadata; the API key
 * remains in [AndroidKeystoreSecretStore] and task/report data remains in
 * app-private files.
 */
class LocalPreferences(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun schemaVersion(): Int = VERSION

  fun readProfile(): LocalProfile? = synchronized(LOCK) {
    if (!preferences.getBoolean(PROFILE_PRESENT, false)) return@synchronized null
    LocalProfile(
      localProfileId = preferences.getString(PROFILE_ID, null) ?: return@synchronized null,
      remoteAccountId = preferences.getString(PROFILE_REMOTE_ACCOUNT_ID, null),
      displayName = preferences.getString(PROFILE_DISPLAY_NAME, null) ?: return@synchronized null,
      avatarUri = preferences.getString(PROFILE_AVATAR_URI, null),
      businessName = preferences.getString(PROFILE_BUSINESS_NAME, null),
      industry = preferences.getString(PROFILE_INDUSTRY, null),
      businessTagsJson = preferences.getString(PROFILE_BUSINESS_TAGS_JSON, "[]") ?: "[]",
      createdAtEpochMs = preferences.getLong(PROFILE_CREATED_AT, 0L),
      updatedAtEpochMs = preferences.getLong(PROFILE_UPDATED_AT, 0L),
    )
  }

  fun saveProfile(profile: LocalProfile) = synchronized(LOCK) {
    preferences.edit()
      .putBoolean(PROFILE_PRESENT, true)
      .putString(PROFILE_ID, LOCAL_PROFILE_ID)
      .putNullable(PROFILE_REMOTE_ACCOUNT_ID, profile.remoteAccountId)
      .putString(PROFILE_DISPLAY_NAME, profile.displayName)
      .putNullable(PROFILE_AVATAR_URI, profile.avatarUri)
      .putNullable(PROFILE_BUSINESS_NAME, profile.businessName)
      .putNullable(PROFILE_INDUSTRY, profile.industry)
      .putString(PROFILE_BUSINESS_TAGS_JSON, profile.businessTagsJson)
      .putLong(PROFILE_CREATED_AT, profile.createdAtEpochMs)
      .putLong(PROFILE_UPDATED_AT, profile.updatedAtEpochMs)
      .commitOrThrow("Could not save the local profile.")
  }

  fun readAiConnection(): LocalAiConnection? = synchronized(LOCK) {
    if (!preferences.getBoolean(AI_CONNECTION_PRESENT, false)) return@synchronized null
    LocalAiConnection(
      connectionId = preferences.getString(AI_CONNECTION_ID, null) ?: return@synchronized null,
      baseUrl = preferences.getString(AI_BASE_URL, null) ?: return@synchronized null,
      textModel = preferences.getString(AI_TEXT_MODEL, null) ?: return@synchronized null,
      visionModel = preferences.getString(AI_VISION_MODEL, null),
      asrModel = preferences.getString(AI_ASR_MODEL, null),
      asrTransport = preferences.getString(AI_ASR_TRANSPORT, null),
      jsonObjectEnabled = preferences.getBoolean(AI_JSON_OBJECT_ENABLED, false),
      jsonSchemaEnabled = preferences.getBoolean(AI_JSON_SCHEMA_ENABLED, false),
      probeResultsJson = preferences.getString(AI_PROBE_RESULTS_JSON, "[]") ?: "[]",
      createdAtEpochMs = preferences.getLong(AI_CREATED_AT, 0L),
      updatedAtEpochMs = preferences.getLong(AI_UPDATED_AT, 0L),
    )
  }

  fun saveAiConnection(connection: LocalAiConnection) = synchronized(LOCK) {
    preferences.edit()
      .putBoolean(AI_CONNECTION_PRESENT, true)
      .putString(AI_CONNECTION_ID, ACTIVE_AI_CONNECTION_ID)
      .putString(AI_BASE_URL, connection.baseUrl)
      .putString(AI_TEXT_MODEL, connection.textModel)
      .putNullable(AI_VISION_MODEL, connection.visionModel)
      .putNullable(AI_ASR_MODEL, connection.asrModel)
      .putNullable(AI_ASR_TRANSPORT, connection.asrTransport)
      .putBoolean(AI_JSON_OBJECT_ENABLED, connection.jsonObjectEnabled)
      .putBoolean(AI_JSON_SCHEMA_ENABLED, connection.jsonSchemaEnabled)
      .putString(AI_PROBE_RESULTS_JSON, connection.probeResultsJson)
      .putLong(AI_CREATED_AT, connection.createdAtEpochMs)
      .putLong(AI_UPDATED_AT, connection.updatedAtEpochMs)
      .commitOrThrow("Could not save the local AI connection.")
  }

  /** A narrow CAS prevents a slow probe from restoring stale connection fields. */
  fun compareAndSetAiProbeResults(
    expectedUpdatedAtEpochMs: Long,
    probeResultsJson: String,
    updatedAtEpochMs: Long,
  ): Boolean = synchronized(LOCK) {
    val connection = readAiConnection() ?: return@synchronized false
    if (connection.updatedAtEpochMs != expectedUpdatedAtEpochMs) return@synchronized false
    saveAiConnection(connection.copy(probeResultsJson = probeResultsJson, updatedAtEpochMs = updatedAtEpochMs))
    true
  }

  private fun SharedPreferences.Editor.putNullable(key: String, value: String?): SharedPreferences.Editor = apply {
    if (value == null) remove(key) else putString(key, value)
  }

  private fun SharedPreferences.Editor.commitOrThrow(message: String) {
    if (!commit()) throw IllegalStateException(message)
  }

  companion object {
    const val VERSION = 1
    const val LOCAL_PROFILE_ID = "local"
    const val ACTIVE_AI_CONNECTION_ID = "active"

    private const val PREFERENCES_NAME = "hongtai.local.preferences.v1"
    private const val PROFILE_PRESENT = "profile.present"
    private const val PROFILE_ID = "profile.id"
    private const val PROFILE_REMOTE_ACCOUNT_ID = "profile.remoteAccountId"
    private const val PROFILE_DISPLAY_NAME = "profile.displayName"
    private const val PROFILE_AVATAR_URI = "profile.avatarUri"
    private const val PROFILE_BUSINESS_NAME = "profile.businessName"
    private const val PROFILE_INDUSTRY = "profile.industry"
    private const val PROFILE_BUSINESS_TAGS_JSON = "profile.businessTagsJson"
    private const val PROFILE_CREATED_AT = "profile.createdAtEpochMs"
    private const val PROFILE_UPDATED_AT = "profile.updatedAtEpochMs"
    private const val AI_CONNECTION_PRESENT = "aiConnection.present"
    private const val AI_CONNECTION_ID = "aiConnection.id"
    private const val AI_BASE_URL = "aiConnection.baseUrl"
    private const val AI_TEXT_MODEL = "aiConnection.textModel"
    private const val AI_VISION_MODEL = "aiConnection.visionModel"
    private const val AI_ASR_MODEL = "aiConnection.asrModel"
    private const val AI_ASR_TRANSPORT = "aiConnection.asrTransport"
    private const val AI_JSON_OBJECT_ENABLED = "aiConnection.jsonObjectEnabled"
    private const val AI_JSON_SCHEMA_ENABLED = "aiConnection.jsonSchemaEnabled"
    private const val AI_PROBE_RESULTS_JSON = "aiConnection.probeResultsJson"
    private const val AI_CREATED_AT = "aiConnection.createdAtEpochMs"
    private const val AI_UPDATED_AT = "aiConnection.updatedAtEpochMs"
    private val LOCK = Any()
  }
}
