package com.hongtai.aiagent

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.util.UnstableApi
import com.getcapacitor.BridgeActivity
import com.hongtai.aiagent.bridge.FileMediaPlugin
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
    registerPlugin(LocalDataPlugin::class.java)
    registerPlugin(LocalFilesPlugin::class.java)
    registerPlugin(NativeNetworkPlugin::class.java)
    registerPlugin(FileMediaPlugin::class.java)
    registerPlugin(MediaRuntimePlugin::class.java)
    registerPlugin(ProductionRuntimePlugin::class.java)
    super.onCreate(savedInstanceState)

    // Long ingest and on-device render work is owned by this foreground
    // WebView process. Avoid moving it into the background merely because the
    // user waited for the screen timeout; Android clears this when hidden.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
