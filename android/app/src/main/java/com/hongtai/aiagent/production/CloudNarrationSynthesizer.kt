package com.hongtai.aiagent.production

import android.content.Context
import android.util.Base64
import com.hongtai.aiagent.network.NativeNetworkPolicy
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import com.hongtai.aiagent.storage.LocalAiConnection
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONObject

internal enum class CloudNarrationTransport {
  MIMO_CHAT_AUDIO,
  STEPFUN_AUDIO_SPEECH,
}

private const val MAX_CLOUD_TTS_CONFIG_VALUE_LENGTH = 200

/** Public connection metadata is validated before the protected key is read. */
internal data class CloudNarrationConfiguration(
  val baseUrl: String,
  val model: String,
  val transport: CloudNarrationTransport,
  val voice: String,
) {
  companion object {
    fun from(connection: LocalAiConnection?): CloudNarrationConfiguration {
      val candidate = connection ?: throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "Cloud TTS is not configured.")
      val model = candidate.ttsModel?.trim().orEmpty()
      val voice = candidate.ttsVoice?.trim().orEmpty()
      val transport = when (candidate.ttsTransport) {
        "mimo-chat-audio" -> CloudNarrationTransport.MIMO_CHAT_AUDIO
        "stepfun-audio-speech" -> CloudNarrationTransport.STEPFUN_AUDIO_SPEECH
        else -> null
      }
      if (model.isBlank() || voice.isBlank() || transport == null) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "Cloud TTS is not configured.")
      }
      requireSafeValue(model, "TTS model")
      requireSafeValue(voice, "TTS voice")
      return CloudNarrationConfiguration(candidate.baseUrl, model, transport, voice)
    }

    private fun requireSafeValue(value: String, label: String) {
      if (value.length > MAX_CLOUD_TTS_CONFIG_VALUE_LENGTH || value.any { it.code < 32 || it.code == 127 }) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "$label is invalid.")
      }
    }
  }
}

/**
 * Native-only cloud speech adapter. It reads the Key inside Keystore-backed
 * native memory, writes a verified WAV only into the production's private
 * directory, and never emits provider response text to the WebView.
 */
internal class CloudNarrationSynthesizer(
  private val context: Context,
  private val store: ProductionMediaStore,
  private val configuration: CloudNarrationConfiguration,
  private val secrets: AndroidKeystoreSecretStore = AndroidKeystoreSecretStore(context),
) : NarrationSynthesizer {
  override fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>> {
    if (!secrets.hasActiveAiConnectionSecret()) {
      throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "The protected cloud TTS credential is unavailable.")
    }
    return secrets.withActiveAiConnectionSecret { apiKey ->
      plan.shots.map { shot -> synthesizeShot(projectId, shot, plan.speechRate, apiKey) to shot.durationMs }
    }
  }

  /** Executes the exact saved protocol with a non-personal short phrase, then deletes it. */
  fun probe() {
    if (!secrets.hasActiveAiConnectionSecret()) {
      throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "The protected cloud TTS credential is unavailable.")
    }
    val temporary = File(context.cacheDir, "hongtai-tts-probe-${System.nanoTime()}.wav")
    try {
      secrets.withActiveAiConnectionSecret { apiKey -> writeAudio(temporary, "配音检测完成。", 1f, apiKey) }
    } finally {
      temporary.delete()
    }
  }

  private fun synthesizeShot(projectId: String, shot: ProductionShot, speechRate: Float, apiKey: CharArray): File {
    val output = File(store.audioDirectory(projectId), "narration-${shot.order}.wav")
    val temporary = File(output.parentFile, ".narration-${shot.order}.part.wav")
    try {
      writeAudio(temporary, shot.narration, speechRate, apiKey)
      finalizeNarrationSegment(temporary, output)
      return output
    } finally {
      temporary.delete()
    }
  }

  private fun writeAudio(output: File, text: String, speechRate: Float, apiKey: CharArray) {
    val narration = text.trim()
    if (narration.isBlank() || narration.length > MAX_NARRATION_CHARACTERS) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "The narration text is invalid for cloud TTS.")
    }
    if (output.exists() && !output.delete()) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not replace a temporary cloud TTS file.")
    }
    try {
      when (configuration.transport) {
        CloudNarrationTransport.MIMO_CHAT_AUDIO -> writeMiMoAudio(output, narration, apiKey)
        CloudNarrationTransport.STEPFUN_AUDIO_SPEECH -> writeStepFunAudio(output, narration, speechRate, apiKey)
      }
      if (!isWavFile(output)) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS did not return a WAV audio file.")
      }
    } catch (error: ProductionException) {
      throw error
    } catch (error: SocketTimeoutException) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS timed out.", error)
    } catch (error: Exception) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS synthesis failed.", error)
    } finally {
      if (!output.isFile || output.length() == 0L) output.delete()
    }
  }

  private fun writeMiMoAudio(output: File, narration: String, apiKey: CharArray) {
    val payload = CloudTtsProtocol.miMoPayload(configuration.model, configuration.voice, narration)
    openJsonRequest("chat/completions", payload, apiKey).useSuccessInput { input, _ ->
      val root = try {
        JSONObject(readUtf8Bounded(input, MAX_MIMO_JSON_BYTES))
      } catch (error: Exception) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "MiMo TTS returned an invalid response.", error)
      }
      val encoded = root.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")
        ?.optJSONObject("audio")?.optString("data")?.trim().orEmpty()
      if (encoded.isBlank() || encoded.length > MAX_BASE64_AUDIO_CHARACTERS) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "MiMo TTS returned no audio data.")
      }
      val bytes = try {
        Base64.decode(encoded, Base64.DEFAULT)
      } catch (error: IllegalArgumentException) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "MiMo TTS returned invalid audio data.", error)
      }
      if (bytes.isEmpty() || bytes.size > MAX_AUDIO_BYTES) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "MiMo TTS audio is outside the supported size.")
      }
      writeBytes(output, bytes)
    }
  }

  private fun writeStepFunAudio(output: File, narration: String, speechRate: Float, apiKey: CharArray) {
    val payload = CloudTtsProtocol.stepFunPayload(configuration.model, configuration.voice, narration, speechRate)
    openJsonRequest("audio/speech", payload, apiKey).useSuccessInput { input, contentType ->
      if (!contentType.startsWith("audio/", ignoreCase = true)) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "StepFun TTS did not return an audio response.")
      }
      copyBounded(input, output)
    }
  }

  private fun openJsonRequest(relativePath: String, payload: JSONObject, apiKey: CharArray): HttpsURLConnection {
    val endpoint = NativeNetworkPolicy.resolveAiEndpoint(configuration.baseUrl, relativePath)
    NativeNetworkPolicy.requirePublicNetworkTarget(endpoint, "cloud TTS request")
    val connection = endpoint.openConnection() as? HttpsURLConnection
      ?: throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS endpoint is not HTTPS.")
    try {
      val bytes = payload.toString().toByteArray(StandardCharsets.UTF_8)
      connection.instanceFollowRedirects = false
      connection.requestMethod = "POST"
      connection.connectTimeout = REQUEST_TIMEOUT_MS
      connection.readTimeout = REQUEST_TIMEOUT_MS
      connection.doInput = true
      connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer ${String(apiKey)}")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setFixedLengthStreamingMode(bytes.size)
      connection.outputStream.use { output -> output.write(bytes) }
      return connection
    } catch (error: Exception) {
      connection.disconnect()
      throw error
    }
  }

  private inline fun HttpsURLConnection.useSuccessInput(block: (InputStream, String) -> Unit) {
    try {
      val status = responseCode
      if (status !in 200..299) {
        errorStream?.use { drainBounded(it) }
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS request was rejected.")
      }
      inputStream.use { input -> block(input, contentType?.substringBefore(';').orEmpty()) }
    } finally {
      disconnect()
    }
  }

  private fun writeBytes(output: File, bytes: ByteArray) {
    FileOutputStream(output).use { stream ->
      stream.write(bytes)
      stream.fd.sync()
    }
  }

  private fun copyBounded(input: InputStream, output: File) {
    var total = 0
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    FileOutputStream(output).use { stream ->
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        total += count
        if (total > MAX_AUDIO_BYTES) {
          throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS audio is outside the supported size.")
        }
        stream.write(buffer, 0, count)
      }
      stream.fd.sync()
    }
    if (total == 0) throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS returned an empty audio file.")
  }

  private fun readUtf8Bounded(input: InputStream, maximumBytes: Int): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      if (output.size() + count > maximumBytes) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Cloud TTS response is outside the supported size.")
      }
      output.write(buffer, 0, count)
    }
    return output.toString(StandardCharsets.UTF_8.name())
  }

  private fun drainBounded(input: InputStream) {
    var remaining = ERROR_DRAIN_BYTES
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    while (remaining > 0) {
      val count = input.read(buffer, 0, minOf(buffer.size, remaining))
      if (count < 0) break
      remaining -= count
    }
  }

  private fun isWavFile(file: File): Boolean {
    if (!file.isFile || file.length() < 12L) return false
    val header = ByteArray(12)
    return FileInputStream(file).use { input ->
      if (input.read(header) != header.size) return@use false
      header.copyOfRange(0, 4).contentEquals("RIFF".toByteArray(StandardCharsets.US_ASCII)) &&
        header.copyOfRange(8, 12).contentEquals("WAVE".toByteArray(StandardCharsets.US_ASCII))
    }
  }

  private companion object {
    const val MAX_NARRATION_CHARACTERS = 1_000
    const val REQUEST_TIMEOUT_MS = 90_000
    const val MAX_AUDIO_BYTES = 12 * 1024 * 1024
    const val MAX_BASE64_AUDIO_CHARACTERS = 17 * 1024 * 1024
    const val MAX_MIMO_JSON_BYTES = 18 * 1024 * 1024
    const val COPY_BUFFER_BYTES = 8 * 1024
    const val ERROR_DRAIN_BYTES = 8 * 1024
  }
}

/** Exact vendor wire bodies, isolated for JVM contract tests. */
internal object CloudTtsProtocol {
  fun miMoPayload(model: String, voice: String, narration: String): JSONObject = JSONObject()
    .put("model", model)
    .put("messages", JSONArray()
      .put(JSONObject().put("role", "user").put("content", "请以自然、清晰的普通话播报。"))
      .put(JSONObject().put("role", "assistant").put("content", narration)))
    .put("audio", JSONObject().put("format", "wav").put("voice", voice))

  fun stepFunPayload(model: String, voice: String, narration: String, speechRate: Float): JSONObject = JSONObject()
    .put("model", model)
    .put("voice", voice)
    .put("input", narration)
    .put("response_format", "wav")
    .put("speed", speechRate.coerceIn(0.5f, 2f))
    .put("instruction", "自然、清晰的中文视频旁白。")
}
