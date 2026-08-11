package com.hongtai.aiagent.bridge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.speech.tts.TextToSpeech
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Opens only Android-owned settings and exposes the APK's compiled identity. */
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

  @PluginMethod
  fun openTextToSpeechSettings(call: PluginCall) {
    val intent = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
    if (context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) == null) {
      call.reject("The system text-to-speech settings screen is unavailable.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE)
      return
    }
    try {
      activity.startActivity(intent)
      call.resolve()
    } catch (error: ActivityNotFoundException) {
      call.reject("The system text-to-speech settings screen is unavailable.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE, error)
    } catch (error: Exception) {
      call.reject("Could not open the system text-to-speech settings screen.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE, error)
    }
  }
}
