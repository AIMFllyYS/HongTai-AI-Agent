package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import com.hongtai.aiagent.storage.SecureStorageException

@CapacitorPlugin(name = "SecureSettings")
class SecureSettingsPlugin : Plugin() {
  private val secretStore: AndroidKeystoreSecretStore by lazy {
    AndroidKeystoreSecretStore(context)
  }

  @PluginMethod
  fun writeSecret(call: PluginCall) {
    val slot = call.getString("slot")
    val value = call.getString("value")
    if (slot != ACTIVE_AI_CONNECTION_SLOT || value.isNullOrBlank()) {
      call.reject("A non-empty active AI connection secret is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    try {
      secretStore.writeActiveAiConnectionSecret(value)
      call.resolve()
    } catch (error: SecureStorageException) {
      call.reject(error.message, NativeIssueCode.SECURE_STORAGE_UNAVAILABLE, error)
    }
  }

  @PluginMethod
  fun hasSecret(call: PluginCall) {
    if (call.getString("slot") != ACTIVE_AI_CONNECTION_SLOT) {
      call.reject("Unknown secret slot.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    try {
      call.resolve(JSObject().put("exists", secretStore.hasActiveAiConnectionSecret()))
    } catch (error: SecureStorageException) {
      call.reject(error.message, NativeIssueCode.SECURE_STORAGE_UNAVAILABLE, error)
    }
  }

  @PluginMethod
  fun removeSecret(call: PluginCall) {
    if (call.getString("slot") != ACTIVE_AI_CONNECTION_SLOT) {
      call.reject("Unknown secret slot.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    try {
      secretStore.removeActiveAiConnectionSecret()
      call.resolve()
    } catch (error: SecureStorageException) {
      call.reject(error.message, NativeIssueCode.SECURE_STORAGE_UNAVAILABLE, error)
    }
  }

  private companion object {
    const val ACTIVE_AI_CONNECTION_SLOT = "active-ai-connection"
  }
}
