package com.hongtai.aiagent

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.hongtai.aiagent.bridge.FileMediaPlugin
import com.hongtai.aiagent.bridge.LocalDataPlugin
import com.hongtai.aiagent.bridge.MediaRuntimePlugin
import com.hongtai.aiagent.bridge.NativeNetworkPlugin
import com.hongtai.aiagent.bridge.SecureSettingsPlugin
import com.hongtai.aiagent.bridge.TaskRuntimePlugin
import com.hongtai.aiagent.runtime.TaskRecoveryRegistry
import com.hongtai.aiagent.storage.LocalEncryptedStorage
import com.hongtai.aiagent.storage.LocalStorageException

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(SecureSettingsPlugin::class.java)
    registerPlugin(NativeNetworkPlugin::class.java)
    registerPlugin(FileMediaPlugin::class.java)
    registerPlugin(MediaRuntimePlugin::class.java)
    registerPlugin(TaskRuntimePlugin::class.java)
    registerPlugin(LocalDataPlugin::class.java)
    super.onCreate(savedInstanceState)

    // Never turn a failed Keystore/SQLCipher migration into an empty database.
    // Recovery is enabled only after the encrypted store opened successfully.
    try {
      TaskRecoveryRegistry.install(LocalEncryptedStorage.initialize(applicationContext))
      TaskRecoveryRegistry.recoverAtStartup()
    } catch (error: LocalStorageException) {
      TaskRecoveryRegistry.markStorageUnavailable(error.code.wireCode)
    }
  }
}
