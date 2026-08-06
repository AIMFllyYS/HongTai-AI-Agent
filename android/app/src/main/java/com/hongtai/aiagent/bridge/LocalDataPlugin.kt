package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.storage.LocalAiConnection
import com.hongtai.aiagent.storage.LocalDataPublicMapper
import com.hongtai.aiagent.storage.LocalEncryptedStorage
import com.hongtai.aiagent.storage.LocalProfile
import com.hongtai.aiagent.storage.LocalStorageException
import com.hongtai.aiagent.storage.SchemaV1
import com.hongtai.aiagent.storage.SqlCipherLocalStore

/**
 * Narrow local-data bridge for settings/profile UI. SQL, database keys, and API
 * keys are deliberately absent from this plugin's public contract.
 */
@CapacitorPlugin(name = "LocalData")
class LocalDataPlugin : Plugin() {
  @PluginMethod
  fun initialize(call: PluginCall) = withStorage(call) { storage ->
    call.resolve(JSObject().put("schemaVersion", SchemaV1.version))
  }

  @PluginMethod
  fun getProfile(call: PluginCall) = withStorage(call) { storage ->
    val response = JSObject()
    storage.read()?.let { profile -> response.put("profile", LocalDataPublicMapper.profile(profile).toJsObject()) }
    call.resolve(response)
  }

  @PluginMethod
  fun saveProfile(call: PluginCall) = withStorage(call) { storage ->
    storage.save(call.toLocalProfile())
    call.resolve()
  }

  @PluginMethod
  fun getAiConnection(call: PluginCall) = withStorage(call) { storage ->
    val response = JSObject()
    storage.readAiConnection()?.let { connection ->
      response.put("connection", LocalDataPublicMapper.aiConnection(connection).toJsObject())
    }
    call.resolve(response)
  }

  @PluginMethod
  fun saveAiConnection(call: PluginCall) = withStorage(call) { storage ->
    storage.saveAiConnection(call.toLocalAiConnection())
    call.resolve()
  }

  private fun withStorage(call: PluginCall, action: (com.hongtai.aiagent.storage.SqlCipherLocalStore) -> Unit) {
    try {
      action(LocalEncryptedStorage.initialize(context))
    } catch (error: LocalStorageException) {
      call.reject(error.message ?: "Local encrypted storage is unavailable.", error.code.wireCode, error)
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "Invalid local data input.", NativeIssueCode.INVALID_ARGUMENT, error)
    }
  }

  private fun PluginCall.toLocalProfile(): LocalProfile = LocalProfile(
    // v1 has one local profile. Never allow a WebView-supplied id to create
    // another encrypted record.
    localProfileId = SqlCipherLocalStore.LOCAL_PROFILE_ID,
    remoteAccountId = getString("remoteAccountId"),
    displayName = requiredString("displayName"),
    avatarUri = getString("avatarUri"),
    businessName = getString("businessName"),
    industry = getString("industry"),
    businessTagsJson = getString("businessTagsJson", "[]") ?: "[]",
    createdAtEpochMs = requiredEpoch("createdAtEpochMs"),
    updatedAtEpochMs = requiredEpoch("updatedAtEpochMs"),
  )

  private fun PluginCall.toLocalAiConnection(): LocalAiConnection = LocalAiConnection(
    // v1 has one active OpenAI-compatible connection, not a provider profile list.
    connectionId = SqlCipherLocalStore.ACTIVE_AI_CONNECTION_ID,
    baseUrl = requiredString("baseUrl"),
    textModel = requiredString("textModel"),
    visionModel = getString("visionModel"),
    asrModel = getString("asrModel"),
    asrTransport = getString("asrTransport"),
    jsonObjectEnabled = getBoolean("jsonObjectEnabled", false) ?: false,
    jsonSchemaEnabled = getBoolean("jsonSchemaEnabled", false) ?: false,
    probeResultsJson = getString("probeResultsJson", "[]") ?: "[]",
    createdAtEpochMs = requiredEpoch("createdAtEpochMs"),
    updatedAtEpochMs = requiredEpoch("updatedAtEpochMs"),
  )

  private fun PluginCall.requiredString(name: String): String = getString(name)?.takeIf { it.isNotBlank() }
    ?: throw IllegalArgumentException("$name is required.")

  private fun PluginCall.requiredEpoch(name: String): Long = when (val value = data.opt(name)) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull()
    else -> null
  } ?: throw IllegalArgumentException("$name must be an epoch timestamp.")

  private fun Map<String, Any?>.toJsObject(): JSObject = JSObject().also { target ->
    forEach { (key, value) -> target.put(key, value) }
  }
}
