package com.hongtai.aiagent.bridge

import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Exposes the APK's compiled identity without exposing application state. */
@CapacitorPlugin(name = "DeviceSettings")
class DeviceSettingsPlugin : Plugin() {
  @PluginMethod
  fun getAppInfo(call: PluginCall) {
    val packageInfo = try {
      context.packageManager.getPackageInfo(context.packageName, 0)
    } catch (error: PackageManager.NameNotFoundException) {
      call.reject("The installed package identity is unavailable.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE, error)
      return
    }
    @Suppress("DEPRECATION")
    val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) packageInfo.longVersionCode else packageInfo.versionCode.toLong()
    call.resolve(
      JSObject()
        .put("versionName", packageInfo.versionName ?: "")
        .put("versionCode", versionCode),
    )
  }
}
