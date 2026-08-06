package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The public bridge exists before the phase-5 worker. Returning a stable error
 * is intentional: the app must never report a fabricated download or SSE run.
 */
@CapacitorPlugin(name = "NativeNetwork")
class NativeNetworkPlugin : Plugin() {
  @PluginMethod
  fun getCapabilities(call: PluginCall) {
    call.resolve(
      JSObject()
        .put("download", "planned")
        .put("sse", "planned"),
    )
  }

  @PluginMethod
  fun enqueueDownload(call: PluginCall) = notReady(call)

  @PluginMethod
  fun openSseStream(call: PluginCall) = notReady(call)

  private fun notReady(call: PluginCall) {
    call.reject(
      "Native download and streaming have not been connected yet.",
      NativeIssueCode.NATIVE_NETWORK_NOT_READY,
    )
  }
}
