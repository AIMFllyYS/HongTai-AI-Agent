package com.hongtai.aiagent

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity
import com.hongtai.aiagent.bridge.FileMediaPlugin
import com.hongtai.aiagent.bridge.LocalDataPlugin
import com.hongtai.aiagent.bridge.LocalFilesPlugin
import com.hongtai.aiagent.bridge.MediaRuntimePlugin
import com.hongtai.aiagent.bridge.NativeNetworkPlugin
import com.hongtai.aiagent.bridge.ProductionRuntimePlugin
import com.hongtai.aiagent.bridge.SecureSettingsPlugin

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(SecureSettingsPlugin::class.java)
    registerPlugin(LocalDataPlugin::class.java)
    registerPlugin(LocalFilesPlugin::class.java)
    registerPlugin(NativeNetworkPlugin::class.java)
    registerPlugin(FileMediaPlugin::class.java)
    registerPlugin(MediaRuntimePlugin::class.java)
    registerPlugin(ProductionRuntimePlugin::class.java)
    super.onCreate(savedInstanceState)

    WindowCompat.enableEdgeToEdge(window)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
    val contentView = findViewById<View>(android.R.id.content)
    contentView.setBackgroundColor(Color.rgb(248, 250, 247))
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->
      val safeInsets = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(contentView)
    bridge.webView.overScrollMode = View.OVER_SCROLL_ALWAYS
  }
}
