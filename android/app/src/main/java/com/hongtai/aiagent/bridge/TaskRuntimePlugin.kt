package com.hongtai.aiagent.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.runtime.TaskForegroundService
import com.hongtai.aiagent.runtime.TaskRecoveryRegistry
import com.hongtai.aiagent.runtime.TaskRecoveryStartupResult

@CapacitorPlugin(name = "TaskRuntime")
class TaskRuntimePlugin : Plugin() {
  @PluginMethod
  fun startForegroundTask(call: PluginCall) {
    val taskId = call.getString("taskId")
    val title = call.getString("title")
    val message = call.getString("message")
    if (taskId.isNullOrBlank() || title.isNullOrBlank() || message.isNullOrBlank()) {
      call.reject("taskId, title, and message are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    TaskForegroundService.start(context, taskId, title, message)
    call.resolve()
  }

  @PluginMethod
  fun stopForegroundTask(call: PluginCall) {
    if (call.getString("taskId").isNullOrBlank()) {
      call.reject("taskId is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    TaskForegroundService.stop(context)
    call.resolve()
  }

  @PluginMethod
  fun recoverInterruptedTasks(call: PluginCall) {
    // Startup recovery is performed once from MainActivity. The bridge only
    // reads that outcome so an ordinary WebView call cannot interrupt tasks
    // created after startup.
    when (val recovery = TaskRecoveryRegistry.latestStartupResult()) {
      is TaskRecoveryStartupResult.Recovered -> {
        val taskIds = recovery.taskIds
        call.resolve(
          JSObject()
            .put("taskIds", JSArray(taskIds))
            .put("status", "interrupted"),
        )
      }
      is TaskRecoveryStartupResult.StorageUnavailable -> call.reject(
        "Encrypted task recovery storage is not ready.",
        recovery.errorCode,
      )
    }
  }
}
