package com.hongtai.aiagent

import android.os.Bundle
import android.view.View
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.hongtai.aiagent.bridge.FileMediaPlugin
import com.hongtai.aiagent.bridge.LocalDataPlugin
import com.hongtai.aiagent.bridge.LocalFilesPlugin
import com.hongtai.aiagent.bridge.MediaRuntimePlugin
import com.hongtai.aiagent.bridge.NativeNetworkPlugin
import com.hongtai.aiagent.bridge.SecureSettingsPlugin

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(SecureSettingsPlugin::class.java)
    registerPlugin(LocalDataPlugin::class.java)
    registerPlugin(LocalFilesPlugin::class.java)
    registerPlugin(NativeNetworkPlugin::class.java)
    registerPlugin(FileMediaPlugin::class.java)
    registerPlugin(MediaRuntimePlugin::class.java)
    super.onCreate(savedInstanceState)

    WindowCompat.enableEdgeToEdge(window)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
    bridge.webView.overScrollMode = View.OVER_SCROLL_ALWAYS
  }
}
