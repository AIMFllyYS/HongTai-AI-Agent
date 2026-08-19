package com.hongtai.aiagent.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.media.AndroidMediaRuntime
import com.hongtai.aiagent.media.MediaDecodeException
import com.hongtai.aiagent.media.MediaProbeException
import com.hongtai.aiagent.media.MediaRemuxException
import com.hongtai.aiagent.media.PcmWavSegmentationException
import com.hongtai.aiagent.runtime.ActiveWorkScreenStay
import java.util.concurrent.Executors

@CapacitorPlugin(name = "MediaRuntime")
class MediaRuntimePlugin : Plugin() {
  private val mediaRuntime: AndroidMediaRuntime by lazy { AndroidMediaRuntime(context) }
  @PluginMethod
  fun getCapabilities(call: PluginCall) {
    call.resolve(
      JSObject()
        .put("probe", "available")
        .put("mediaCodec", "available")
        .put("remux", "available")
        .put("pcmSegmentation", "available"),
    )
  }

  @PluginMethod
  fun probe(call: PluginCall) {
    val uri = call.getString("uri")
    if (uri.isNullOrBlank()) {
      call.reject("uri is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    runMediaOperation(call) {
      try {
        val probe = mediaRuntime.probeNow(uri)
        call.resolve(
          JSObject()
            .putOptional("durationMs", probe.durationMs)
            .putOptional("mimeType", probe.mimeType)
            .putOptional("hasAudio", probe.hasAudio)
            .putOptional("hasVideo", probe.hasVideo),
        )
      } catch (error: IllegalArgumentException) {
        call.reject("The media URI is not an available private file.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      } catch (error: MediaProbeException) {
        call.reject("The private media file could not be probed.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      } catch (error: Exception) {
        call.reject("The private media file could not be probed.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      }
    }
  }

  /** Decoded audio is always written under the source task's generated private `media/pcm` path. */
  @PluginMethod
  fun extractPcmWav(call: PluginCall) {
    val taskId = call.getString("taskId")
    val sourceUri = call.getString("sourceUri")
    if (taskId.isNullOrBlank() || sourceUri.isNullOrBlank()) {
      call.reject("taskId and sourceUri are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    runMediaOperation(call) {
      try {
        val output = mediaRuntime.extractPcmWavNow(taskId, sourceUri)
        call.resolve(
          JSObject()
            .put("uri", output.uri)
            .put("sizeBytes", output.sizeBytes)
            .put("sampleRateHz", output.sampleRateHz)
            .put("channelCount", output.channelCount),
        )
      } catch (error: IllegalArgumentException) {
        call.reject("The media URI is not an available private file.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      } catch (error: MediaDecodeException) {
        call.reject("The private media audio could not be decoded.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      } catch (error: Exception) {
        call.reject("The private media audio could not be decoded.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      }
    }
  }

  /** Splits an existing task-owned canonical WAV artifact into bounded private ASR inputs. */
  @PluginMethod
  fun segmentPcmWav(call: PluginCall) {
    val taskId = call.getString("taskId")
    val sourceUri = call.getString("sourceUri")
    val maxSegmentDurationMs = try {
      call.requiredInt("maxSegmentDurationMs")
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "maxSegmentDurationMs is invalid.", NativeIssueCode.INVALID_ARGUMENT, error)
      return
    }
    if (taskId.isNullOrBlank() || sourceUri.isNullOrBlank()) {
      call.reject("taskId and sourceUri are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    runMediaOperation(call) {
      try {
        val output = mediaRuntime.segmentPcmWavNow(taskId, sourceUri, maxSegmentDurationMs)
        call.resolve(
          JSObject()
            .put("sourceDurationMs", output.sourceDurationMs)
            .put("segments", JSArray().also { segments ->
              output.segments.forEach { segment ->
                segments.put(
                  JSObject()
                    .put("uri", segment.uri)
                    .put("sizeBytes", segment.sizeBytes)
                    .put("durationMs", segment.durationMs)
                    .put("sampleRateHz", segment.sampleRateHz)
                    .put("channelCount", segment.channelCount),
                )
              }
            }),
        )
      } catch (error: IllegalArgumentException) {
        call.reject("The media URI is not an available task-private file.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      } catch (error: PcmWavSegmentationException) {
        call.reject("The private PCM/WAV file could not be segmented safely.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      } catch (error: Exception) {
        call.reject("The private PCM/WAV file could not be segmented safely.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
      }
    }
  }

  /** Remuxes one task's downloaded video plus optional separate AAC audio into private MP4 output. */
  @PluginMethod
  fun remuxVideo(call: PluginCall) {
    val taskId = call.getString("taskId")
    val videoUri = call.getString("videoUri")
    val audioUri = call.getString("audioUri")
    if (taskId.isNullOrBlank() || videoUri.isNullOrBlank()) {
      call.reject("taskId and videoUri are required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    runMediaOperation(call) {
      try {
        val output = mediaRuntime.remuxVideoNow(taskId, videoUri, audioUri)
        call.resolve(
          JSObject()
            .put("uri", output.uri)
            .put("sizeBytes", output.sizeBytes)
            .put("mimeType", output.mimeType)
            .put("hasAudio", output.hasAudio),
        )
      } catch (error: IllegalArgumentException) {
        call.reject("The media URI is not an available task-private file.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      } catch (error: MediaRemuxException) {
        call.reject("The private media files could not be remuxed safely.", NativeIssueCode.MEDIA_MERGE_FAILED, error)
      } catch (error: Exception) {
        call.reject("The private media files could not be remuxed safely.", NativeIssueCode.MEDIA_MERGE_FAILED, error)
      }
    }
  }

  private fun JSObject.putOptional(name: String, value: Any?): JSObject = apply {
    if (value != null) put(name, value)
  }

  private fun PluginCall.requiredInt(name: String): Int = when (val value = data.opt(name)) {
    is Number -> value.toInt().also { parsed ->
      require(value.toDouble() == parsed.toDouble()) { "$name must be an integer." }
    }
    is String -> value.toIntOrNull() ?: throw IllegalArgumentException("$name must be an integer.")
    else -> throw IllegalArgumentException("$name is required.")
  }

  /** Runs one native operation at a time; task state stays entirely in TypeScript. */
  private fun runMediaOperation(call: PluginCall, operation: () -> Unit) {
    try {
      MEDIA_EXECUTOR.execute {
        ActiveWorkScreenStay.acquire(activity)
        try {
          operation()
        } finally {
          ActiveWorkScreenStay.release(activity)
        }
      }
    } catch (error: Exception) {
      call.reject("The native media operation could not start safely.", NativeIssueCode.MEDIA_PROBE_FAILED, error)
    }
  }

  private companion object {
    val MEDIA_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-media-codec").apply { isDaemon = true }
    }
  }
}
