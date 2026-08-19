package com.hongtai.aiagent

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.core.view.WindowCompat
import androidx.media3.common.util.UnstableApi
import com.getcapacitor.BridgeActivity
import com.hongtai.aiagent.bridge.FileMediaPlugin
import com.hongtai.aiagent.bridge.DeviceSettingsPlugin
import com.hongtai.aiagent.bridge.LocalDataPlugin
import com.hongtai.aiagent.bridge.LocalFilesPlugin
import com.hongtai.aiagent.bridge.MediaRuntimePlugin
import com.hongtai.aiagent.bridge.NativeNetworkPlugin
import com.hongtai.aiagent.bridge.ProductionRuntimePlugin
import com.hongtai.aiagent.bridge.SecureSettingsPlugin

class MainActivity : BridgeActivity() {
  @UnstableApi
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(SecureSettingsPlugin::class.java)
    registerPlugin(DeviceSettingsPlugin::class.java)
    registerPlugin(LocalDataPlugin::class.java)
    registerPlugin(LocalFilesPlugin::class.java)
    registerPlugin(NativeNetworkPlugin::class.java)
    registerPlugin(FileMediaPlugin::class.java)
    registerPlugin(MediaRuntimePlugin::class.java)
    registerPlugin(ProductionRuntimePlugin::class.java)
    super.onCreate(savedInstanceState)

    // Screen-on is acquired only while import or render work is in flight.
    // Android 15+ enforces edge-to-edge for this target SDK. The Web document
    // already declares viewport-fit=cover and owns its safe-area spacing, so
    // padding the native content view here would apply the status-bar inset a
    // second time and leave a blank row above every page.
    WindowCompat.enableEdgeToEdge(window)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
    bridge.webView.overScrollMode = View.OVER_SCROLL_ALWAYS
  }
}
