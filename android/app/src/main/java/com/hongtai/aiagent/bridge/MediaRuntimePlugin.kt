package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MediaRuntime")
class MediaRuntimePlugin : Plugin() {
  @PluginMethod
  fun getCapabilities(call: PluginCall) {
    call.resolve(
      JSObject()
        .put("transformer", "planned")
        .put("mediaCodec", "planned"),
    )
  }

  @PluginMethod
  fun probe(call: PluginCall) = notReady(call)

  @PluginMethod
  fun extractPcmWav(call: PluginCall) = notReady(call)

  private fun notReady(call: PluginCall) {
    call.reject(
      "Native media processing has not been connected yet.",
      NativeIssueCode.MEDIA_RUNTIME_NOT_READY,
    )
  }
}
