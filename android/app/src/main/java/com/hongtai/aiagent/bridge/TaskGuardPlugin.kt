package com.hongtai.aiagent.bridge

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.runtime.BackgroundRunPolicy
import com.hongtai.aiagent.runtime.TaskGuardWakeLock

/**
 * Mechanism-only bridge for TaskGuard background running: the partial wake
 * lock counter, the battery-optimization guidance flow, and the process-local
 * background-run policy flag. Business decisions about when to start and stop
 * guarding stay entirely in the shared runtime layer; this plugin never reads
 * business preferences or task state.
 */
@CapacitorPlugin(name = "TaskGuard")
class TaskGuardPlugin : Plugin() {
  @PluginMethod
  fun setBackgroundRunEnabled(call: PluginCall) {
    val enabled = call.getBoolean("enabled") ?: run {
      call.reject("The enabled flag is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    BackgroundRunPolicy.setEnabled(enabled)
    call.resolve()
  }

  @PluginMethod
  fun holdWakeLock(call: PluginCall) {
    val kind = call.getString("kind") ?: run {
      call.reject("The guarded task kind is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val total = TaskGuardWakeLock.hold(context, kind)
    call.resolve(JSObject().put("totalHolds", total))
  }

  @PluginMethod
  fun releaseWakeLock(call: PluginCall) {
    val kind = call.getString("kind") ?: run {
      call.reject("The guarded task kind is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val total = TaskGuardWakeLock.release(kind)
    call.resolve(JSObject().put("totalHolds", total))
  }

  @PluginMethod
  fun getBackgroundRunStatus(call: PluginCall) {
    val powerManager = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
    val ignoring = powerManager.isIgnoringBatteryOptimizations(context.packageName)
    call.resolve(
      JSObject()
        .put("batteryOptimizationIgnored", ignoring)
        .put("wakeLockHolds", TaskGuardWakeLock.totalHolds()),
    )
  }

  /**
   * Opens the system battery-optimization guidance with a three-step
   * fallback: the direct allow-list request dialog, the optimization list
   * screen, then the app details screen. The opened surface is reported so
   * the settings page can explain what the user should do next.
   */
  @PluginMethod
  fun requestIgnoreBatteryOptimizations(call: PluginCall) {
    val host = activity ?: run {
      call.reject("No activity is available to open system settings.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE)
      return
    }
    val request = Intent(
      Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      Uri.parse("package:${context.packageName}"),
    )
    val opened = try {
      host.startActivity(request)
      "request"
    } catch (_: android.content.ActivityNotFoundException) {
      try {
        host.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        "optimization-list"
      } catch (_: android.content.ActivityNotFoundException) {
        try {
          host.startActivity(
            Intent(
              Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
              Uri.parse("package:${context.packageName}"),
            ),
          )
          "app-details"
        } catch (_: android.content.ActivityNotFoundException) {
          null
        }
      }
    }
    if (opened == null) {
      call.reject("No battery-optimization settings surface is available on this device.", NativeIssueCode.SYSTEM_SETTINGS_UNAVAILABLE)
      return
    }
    call.resolve(JSObject().put("opened", opened))
  }
}
