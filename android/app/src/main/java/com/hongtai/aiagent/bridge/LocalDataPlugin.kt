package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.storage.LocalAiConnection
import com.hongtai.aiagent.storage.LocalDataPublicMapper
import com.hongtai.aiagent.storage.LocalPreferences
import com.hongtai.aiagent.storage.LocalProfile
import org.json.JSONArray
import org.json.JSONObject

/**
 * Narrow local-data bridge for settings/profile UI. SharedPreferences contains
 * public metadata only; API keys remain in Android Keystore and task data is
 * stored in fixed app-private files.
 */
@CapacitorPlugin(name = "LocalData")
class LocalDataPlugin : Plugin() {
  @PluginMethod
  fun initialize(call: PluginCall) = withStorage(call) { storage ->
    call.resolve(JSObject().put("schemaVersion", storage.schemaVersion()))
  }

  @PluginMethod
  fun getProfile(call: PluginCall) = withStorage(call) { storage ->
    val response = JSObject()
    storage.readProfile()?.let { profile -> response.put("profile", LocalDataPublicMapper.profile(profile).toJsObject()) }
    call.resolve(response)
  }

  @PluginMethod
  fun saveProfile(call: PluginCall) = withStorage(call) { storage ->
    storage.saveProfile(call.toLocalProfile())
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

  /**
   * A narrow, atomic probe-history update. The bridge never accepts a whole
   * stale connection here, so a slow WebView probe cannot roll back the active
   * Base URL/models after the user saved revised settings.
   */
  @PluginMethod
  fun compareAndSetAiProbeResults(call: PluginCall) = withStorage(call) { storage ->
    val expectedUpdatedAtEpochMs = call.requiredEpoch("expectedUpdatedAtEpochMs")
    val updatedAtEpochMs = call.requiredEpoch("updatedAtEpochMs")
    require(updatedAtEpochMs > expectedUpdatedAtEpochMs) { "Probe result timestamp must advance." }
    val probeResultsJson = call.requiredString("probeResultsJson")
    validateProbeResultsJson(probeResultsJson)
    call.resolve(
      JSObject().put(
        "applied",
        storage.compareAndSetAiProbeResults(expectedUpdatedAtEpochMs, probeResultsJson, updatedAtEpochMs),
      ),
    )
  }

  private fun withStorage(call: PluginCall, action: (LocalPreferences) -> Unit) {
    try {
      action(LocalPreferences(context))
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "Invalid local data input.", NativeIssueCode.INVALID_ARGUMENT, error)
    } catch (error: IllegalStateException) {
      call.reject(error.message ?: "Local preferences are unavailable.", NativeIssueCode.LOCAL_DATA_UNAVAILABLE, error)
    }
  }

  private fun PluginCall.toLocalProfile(): LocalProfile = LocalProfile(
    // v1 has one local profile. Never allow a WebView-supplied id to create
    // another local preference record.
    localProfileId = LocalPreferences.LOCAL_PROFILE_ID,
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
    connectionId = LocalPreferences.ACTIVE_AI_CONNECTION_ID,
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

  /** Validates the fixed public probe projection before it reaches local preferences. */
  private fun validateProbeResultsJson(value: String) {
    require(value.toByteArray(Charsets.UTF_8).size <= MAX_PROBE_RESULTS_BYTES) { "Probe results are too large." }
    val entries = try {
      JSONArray(value)
    } catch (error: Exception) {
      throw IllegalArgumentException("Probe results are invalid.", error)
    }
    require(entries.length() <= PROBE_CAPABILITIES.size) { "Too many probe results." }
    val seenCapabilities = mutableSetOf<String>()
    for (index in 0 until entries.length()) {
      val entry = entries.optJSONObject(index) ?: throw IllegalArgumentException("Probe result is invalid.")
      entry.requireOnlyKeys(PROBE_RESULT_KEYS)
      val capability = entry.requiredKnown("capability", PROBE_CAPABILITIES)
      require(seenCapabilities.add(capability)) { "Probe capability is duplicated." }
      val status = entry.requiredKnown("status", PROBE_STATUSES)
      val checkedAt = entry.requiredString("checkedAt")
      require(checkedAt.length <= MAX_PROBE_TIMESTAMP_LENGTH) { "Probe timestamp is invalid." }
      if (entry.has("model") && !entry.isNull("model")) {
        require(entry.opt("model") is String && entry.getString("model").length <= MAX_PROBE_MODEL_LENGTH) {
          "Probe model is invalid."
        }
      }
      val issue = if (entry.has("issue") && !entry.isNull("issue")) entry.optJSONObject("issue") else null
      if (status == "succeeded") require(issue == null) { "Successful probe must not contain an issue." }
      if (status == "failed") require(issue != null) { "Failed probe must contain an issue." }
      issue?.validateProbeIssue()
    }
  }

  private fun JSONObject.validateProbeIssue() {
    requireOnlyKeys(PROBE_ISSUE_KEYS)
    val code = requiredString("code")
    require(PROBE_ISSUE_CODE.matches(code)) { "Probe issue code is invalid." }
    require(requiredKnown("severity", setOf("error")) == "error")
    val message = requiredString("userMessage")
    require(message.length <= MAX_PROBE_MESSAGE_LENGTH && !PRIVATE_VALUE.matches(message)) {
      "Probe issue message is invalid."
    }
    require(opt("retryable") is Boolean) { "Probe issue retryable is invalid." }
    requiredKnown("action", PROBE_ISSUE_ACTIONS)
  }

  private fun JSONObject.requireOnlyKeys(allowed: Set<String>) {
    val keys = keys()
    while (keys.hasNext()) require(keys.next() in allowed) { "Probe result contains an unsupported field." }
  }

  private fun JSONObject.requiredString(name: String): String = optString(name, "")
    .takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("$name is required.")

  private fun JSONObject.requiredKnown(name: String, allowed: Set<String>): String = requiredString(name).also {
    require(it in allowed) { "$name is invalid." }
  }

  private fun Map<String, Any?>.toJsObject(): JSObject = JSObject().also { target ->
    forEach { (key, value) -> target.put(key, value) }
  }

  private companion object {
    const val MAX_PROBE_RESULTS_BYTES = 16 * 1024
    const val MAX_PROBE_TIMESTAMP_LENGTH = 80
    const val MAX_PROBE_MODEL_LENGTH = 200
    const val MAX_PROBE_MESSAGE_LENGTH = 1_000
    val PROBE_CAPABILITIES = setOf("text", "vision", "asr")
    val PROBE_STATUSES = setOf("succeeded", "failed")
    val PROBE_ISSUE_ACTIONS = setOf(
      "edit_input", "retry", "wait_and_retry", "check_network", "configure_ai", "free_storage", "select_media", "view_partial_result", "none",
    )
    val PROBE_RESULT_KEYS = setOf("capability", "status", "checkedAt", "model", "issue")
    val PROBE_ISSUE_KEYS = setOf("code", "severity", "userMessage", "retryable", "action")
    val PROBE_ISSUE_CODE = Regex("[A-Z][A-Z0-9_]{2,119}")
    val PRIVATE_VALUE = Regex("(?is).*?(?:bearer\\s+\\S+|(?:sk|key)-[A-Za-z0-9_-]{12,}|(?:file|content)://|data:[A-Za-z0-9/+.-]+;base64,).*?")
  }
}
