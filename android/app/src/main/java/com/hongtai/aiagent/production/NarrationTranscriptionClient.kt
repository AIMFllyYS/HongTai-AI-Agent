package com.hongtai.aiagent.production

import com.hongtai.aiagent.network.NativeNetworkPolicy
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

/**
 * Public transcription endpoint metadata validated before the protected key is read. Derived from
 * the same user connection as the TTS instructions; the API key never travels through the WebView.
 */
internal data class NarrationTranscriptionConfiguration(
  val baseUrl: String,
  val model: String,
) {
  companion object {
    const val MAX_CONFIG_VALUE_LENGTH = 200

    fun from(baseUrl: String?, model: String?): NarrationTranscriptionConfiguration {
      val trimmedModel = model?.trim().orEmpty()
      require(
        trimmedModel.isNotEmpty() && trimmedModel.length <= MAX_CONFIG_VALUE_LENGTH &&
          trimmedModel.none { it.code < 32 || it.code == 127 },
      ) { "The transcription model is invalid." }
      return NarrationTranscriptionConfiguration(
        NativeNetworkPolicy.requireHttpsUrl(baseUrl?.trim().orEmpty(), "Transcription Base URL").toString(),
        trimmedModel,
      )
    }
  }
}

/**
 * Native-only OpenAI-compatible transcription adapter (Whisper-style `verbose_json` with word
 * timestamps). It reads the key from the Keystore-backed store, uploads one already-synthesized
 * sentence audio file, and returns raw word timings; cue assembly stays in TypeScript.
 */
internal class NarrationTranscriptionClient(
  private val configuration: NarrationTranscriptionConfiguration,
  private val secrets: AndroidKeystoreSecretStore,
) {
  fun transcribe(audio: File): List<NarrationTranscribedWord> {
    if (!secrets.hasActiveAiConnectionSecret()) {
      throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "The protected transcription credential is unavailable.")
    }
    return secrets.withActiveAiConnectionSecret { apiKey -> transcribe(audio, apiKey) }
  }

  private fun transcribe(audio: File, apiKey: CharArray): List<NarrationTranscribedWord> {
    if (!audio.isFile || audio.length() !in 1..NarrationTranscriptionProtocol.MAX_AUDIO_BYTES) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The narration audio file is outside the supported size.")
    }
    try {
      val endpoint = NativeNetworkPolicy.resolveAiEndpoint(configuration.baseUrl, NarrationTranscriptionProtocol.RELATIVE_PATH)
      NativeNetworkPolicy.requirePublicNetworkTarget(endpoint, "narration transcription request")
      val connection = endpoint.openConnection() as? HttpsURLConnection
        ?: throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription endpoint is not HTTPS.")
      try {
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.connectTimeout = NarrationTranscriptionProtocol.REQUEST_TIMEOUT_MS
        connection.readTimeout = NarrationTranscriptionProtocol.REQUEST_TIMEOUT_MS
        connection.doInput = true
        connection.setRequestProperty("Authorization", "Bearer ${String(apiKey)}")
        val boundary = "hongtai-asr-${java.util.UUID.randomUUID()}"
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        connection.doOutput = true
        connection.setChunkedStreamingMode(NarrationTranscriptionProtocol.CHUNK_BYTES)
        connection.outputStream.use { output ->
          FileInputStream(audio).use { input ->
            NarrationTranscriptionProtocol.writeMultipartBody(output, boundary, configuration.model, audio.name, input)
          }
        }
        val status = connection.responseCode
        if (status !in 200..299) {
          connection.errorStream?.use(NarrationTranscriptionProtocol::drainBounded)
          throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription request was rejected.")
        }
        connection.inputStream.use { input ->
          return NarrationTranscriptionProtocol.parseWords(NarrationTranscriptionProtocol.readUtf8Bounded(input, NarrationTranscriptionProtocol.MAX_RESPONSE_BYTES))
        }
      } finally {
        connection.disconnect()
      }
    } catch (error: ProductionException) {
      throw error
    } catch (error: SocketTimeoutException) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription request timed out.", error)
    } catch (error: Exception) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription request failed.", error)
    }
  }
}

/** Wire format for the OpenAI-compatible transcription endpoint, isolated for JVM contract tests. */
internal object NarrationTranscriptionProtocol {
  const val RELATIVE_PATH = "audio/transcriptions"
  const val REQUEST_TIMEOUT_MS = 90_000
  const val CHUNK_BYTES = 8 * 1_024
  const val MAX_AUDIO_BYTES = 12L * 1_024L * 1_024L
  const val MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024
  const val MAX_WORDS = 2_000
  const val MAX_WORD_CHARACTERS = 64
  private const val ERROR_DRAIN_BYTES = 8 * 1_024

  fun writeMultipartBody(
    output: OutputStream,
    boundary: String,
    model: String,
    filename: String,
    audio: InputStream,
  ) {
    require(filename.isNotBlank() && filename.length <= 240 && filename.none {
      it.code < 32 || it.code == 127 || it == '"' || it == '\r' || it == '\n'
    }) { "The transcription filename is invalid." }
    writeField(output, boundary, "model", model)
    writeField(output, boundary, "response_format", "verbose_json")
    writeField(output, boundary, "timestamp_granularities[]", "word")
    output.writeUtf8("--$boundary\r\n")
    output.writeUtf8("Content-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\n")
    output.writeUtf8("Content-Type: audio/wav\r\n\r\n")
    audio.copyTo(output, CHUNK_BYTES)
    output.writeUtf8("\r\n--$boundary--\r\n")
  }

  private fun writeField(output: OutputStream, boundary: String, name: String, value: String) {
    require(!value.contains('\r') && !value.contains('\n')) { "The transcription field value is invalid." }
    output.writeUtf8("--$boundary\r\n")
    output.writeUtf8("Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
    output.writeUtf8(value)
    output.writeUtf8("\r\n")
  }

  /** `verbose_json` word timestamps; seconds become whole milliseconds. */
  fun parseWords(responseJson: String): List<NarrationTranscribedWord> {
    val root = try {
      JSONObject(responseJson)
    } catch (error: Exception) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription response is invalid.", error)
    }
    val words = root.optJSONArray("words")
      ?: throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription response has no word timestamps.")
    if (words.length() !in 1..MAX_WORDS) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription word count is outside the supported range.")
    }
    return (0 until words.length()).map { index ->
      val value = words.getJSONObject(index)
      val word = value.optString("word").trim()
      val startMs = secondsToMs(value.optDouble("start"))
      val endMs = secondsToMs(value.optDouble("end"))
      if (word.isEmpty() || word.length > MAX_WORD_CHARACTERS) {
        throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "A transcribed word is invalid.")
      }
      if (endMs < startMs) {
        throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "A transcribed word has a negative range.")
      }
      NarrationTranscribedWord(word, startMs, endMs)
    }
  }

  private fun secondsToMs(value: Double): Long {
    if (!value.isFinite() || value < 0.0) {
      throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "A transcribed timestamp is invalid.")
    }
    return Math.round(value * 1_000.0)
  }

  fun readUtf8Bounded(input: InputStream, maximumBytes: Int): String {
    val output = StringBuilder()
    val buffer = ByteArray(CHUNK_BYTES)
    var total = 0
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      total += count
      if (total > maximumBytes) {
        throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "The transcription response is outside the supported size.")
      }
      output.append(String(buffer, 0, count, StandardCharsets.UTF_8))
    }
    return output.toString()
  }

  fun drainBounded(input: InputStream) {
    var remaining = ERROR_DRAIN_BYTES
    val buffer = ByteArray(CHUNK_BYTES)
    while (remaining > 0) {
      val count = input.read(buffer, 0, minOf(buffer.size, remaining))
      if (count < 0) break
      remaining -= count
    }
  }

  private fun OutputStream.writeUtf8(value: String) {
    write(value.toByteArray(StandardCharsets.UTF_8))
  }
}
