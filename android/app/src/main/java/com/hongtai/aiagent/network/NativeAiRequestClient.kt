package com.hongtai.aiagent.network

import android.util.Base64
import com.hongtai.aiagent.media.PrivateArtifactStore
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

sealed interface NativeAiMediaSource {
  data class Base64Value(val value: String) : NativeAiMediaSource
  data class PrivateUri(val uri: String) : NativeAiMediaSource
}

data class NativeAiJsonAttachment(
  val pointer: String,
  val source: NativeAiMediaSource,
  val mimeType: String,
  val materialization: String,
)

data class NativeAiMultipartFile(
  val filename: String,
  val mimeType: String,
  val source: NativeAiMediaSource,
)

sealed interface NativeAiRequestBody {
  data class Json(
    val json: String,
    val attachments: List<NativeAiJsonAttachment>,
  ) : NativeAiRequestBody

  data class Multipart(
    val fields: Map<String, String>,
    val file: NativeAiMultipartFile,
  ) : NativeAiRequestBody
}

data class NativeAiRequest(
  val requestId: String,
  val relativePath: String,
  val headers: Map<String, String>,
  val body: NativeAiRequestBody,
  val responseMode: String,
  val timeoutMs: Int,
)

data class NativeAiResponseHeaders(
  val status: Int,
  val headers: Map<String, String>,
)

class NativeAiRequestException(
  val code: String,
  val userMessage: String,
  val retryable: Boolean = false,
  cause: Throwable? = null,
) : IllegalStateException(userMessage, cause)

/**
 * OpenAI-compatible HTTP transport only. Prompt construction, schema repair,
 * reasoning isolation and response interpretation remain in TypeScript. This
 * class reads no connection metadata and accepts no persisted API key field.
 */
class NativeAiRequestClient(
  private val artifacts: PrivateArtifactStore,
) {
  fun execute(
    request: NativeAiRequest,
    baseUrl: String,
    apiKey: CharArray,
    onHeaders: (NativeAiResponseHeaders) -> Unit,
    onChunk: (String) -> Unit,
    onCompleted: (String?) -> Unit,
  ) {
    validateRequest(request)
    val endpoint = NativeNetworkPolicy.resolveAiEndpoint(baseUrl, request.relativePath)
    try {
      NativeNetworkPolicy.requirePublicNetworkTarget(endpoint, "AI request")
      val connection = (endpoint.openConnection() as? HttpsURLConnection)
        ?: throw NativeAiRequestException("ERR_AI_NETWORK_FAILED", "The AI endpoint is not HTTPS.", retryable = true)
      try {
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.connectTimeout = request.timeoutMs.coerceAtMost(MAX_TIMEOUT_MS)
        connection.readTimeout = request.timeoutMs.coerceAtMost(MAX_TIMEOUT_MS)
        connection.doInput = true
        connection.setRequestProperty("Authorization", "Bearer ${String(apiKey)}")
        request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
        writeBody(connection, request.body)
        val response = NativeAiResponseHeaders(connection.responseCode, publicResponseHeaders(connection))
        onHeaders(response)
        val input = responseInput(connection, response.status)
        if (request.responseMode == RESPONSE_MODE_JSON) {
          val text = input?.use { readUtf8Bounded(it, MAX_JSON_RESPONSE_BYTES) } ?: ""
          onCompleted(text)
        } else {
          input?.use { streamUtf8(it, onChunk) }
          onCompleted(null)
        }
      } finally {
        connection.disconnect()
      }
    } catch (error: NativeAiRequestException) {
      throw error
    } catch (error: SocketTimeoutException) {
      throw NativeAiRequestException("ERR_AI_TIMEOUT", "The AI request timed out.", retryable = true, cause = error)
    } catch (error: InterruptedException) {
      throw NativeAiRequestException("ERR_AI_NETWORK_FAILED", "The AI request was interrupted.", retryable = true, cause = error)
    } catch (error: IOException) {
      throw NativeAiRequestException("ERR_AI_NETWORK_FAILED", "The AI request could not finish.", retryable = true, cause = error)
    }
  }

  private fun validateRequest(request: NativeAiRequest) {
    require(REQUEST_ID.matches(request.requestId)) { "AI request ID is invalid." }
    require(request.responseMode == RESPONSE_MODE_JSON || request.responseMode == RESPONSE_MODE_STREAM) {
      "AI response mode is invalid."
    }
    require(request.timeoutMs in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) { "AI request timeout is invalid." }
    NativeNetworkPolicy.sanitizeAiHeaders(request.headers)
    when (val body = request.body) {
      is NativeAiRequestBody.Json -> {
        require(body.json.toByteArray(StandardCharsets.UTF_8).size <= MAX_JSON_REQUEST_BYTES) {
          "AI JSON request is too large."
        }
        NativeNetworkPolicy.requireCredentialFreeAiJson(body.json)
      }
      is NativeAiRequestBody.Multipart -> body.fields.keys.forEach(NativeNetworkPolicy::requireCredentialFreeAiMultipartField)
    }
  }

  private fun writeBody(connection: HttpsURLConnection, body: NativeAiRequestBody) {
    connection.doOutput = true
    when (body) {
      is NativeAiRequestBody.Json -> {
        val bytes = materializeJson(body).toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= MAX_JSON_REQUEST_BYTES) { "AI JSON request is too large." }
        if (connection.getRequestProperty("Content-Type").isNullOrBlank()) {
          connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        connection.setFixedLengthStreamingMode(bytes.size)
        connection.outputStream.use { output -> output.write(bytes) }
      }
      is NativeAiRequestBody.Multipart -> {
        val boundary = "hongtai-${UUID.randomUUID()}"
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        connection.setChunkedStreamingMode(CHUNK_BYTES)
        connection.outputStream.use { output -> writeMultipart(output, boundary, body) }
      }
    }
  }

  private fun materializeJson(body: NativeAiRequestBody.Json): String {
    require(body.json.length <= MAX_JSON_REQUEST_BYTES) { "AI JSON request is too large." }
    val document = try {
      JSONTokener(body.json).nextValue()
    } catch (error: Exception) {
      throw IllegalArgumentException("AI JSON request is invalid.", error)
    }
    require(document is JSONObject || document is JSONArray) { "AI JSON request root is invalid." }
    body.attachments.forEach { attachment ->
      val base64 = materializeBase64(attachment.source)
      val value = when (attachment.materialization) {
        "raw-base64" -> base64
        "data-url-base64" -> "data:${validatedMimeType(attachment.mimeType)};base64,$base64"
        else -> throw IllegalArgumentException("AI attachment materialization is invalid.")
      }
      setJsonPointer(document, attachment.pointer, value)
    }
    return document.toString()
  }

  private fun writeMultipart(output: OutputStream, boundary: String, body: NativeAiRequestBody.Multipart) {
    body.fields.forEach { (name, value) ->
      validateMultipartField(name, value)
      output.writeUtf8("--$boundary\r\n")
      output.writeUtf8("Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
      output.writeUtf8(value)
      output.writeUtf8("\r\n")
    }
    val file = body.file
    validateFilename(file.filename)
    val mimeType = validatedMimeType(file.mimeType)
    output.writeUtf8("--$boundary\r\n")
    output.writeUtf8("Content-Disposition: form-data; name=\"file\"; filename=\"${file.filename}\"\r\n")
    output.writeUtf8("Content-Type: $mimeType\r\n\r\n")
    sourceInputStream(file.source).use { input -> input.copyTo(output, CHUNK_BYTES) }
    output.writeUtf8("\r\n--$boundary--\r\n")
  }

  private fun materializeBase64(source: NativeAiMediaSource): String = when (source) {
    is NativeAiMediaSource.Base64Value -> {
      require(source.value.length <= MAX_BASE64_CHARACTERS) { "AI base64 attachment is too large." }
      val bytes = try {
        Base64.decode(source.value, Base64.NO_WRAP)
      } catch (error: IllegalArgumentException) {
        throw IllegalArgumentException("AI base64 attachment is invalid.", error)
      }
      require(bytes.size <= MAX_ATTACHMENT_BYTES) { "AI base64 attachment is too large." }
      source.value
    }
    is NativeAiMediaSource.PrivateUri -> {
      val file = artifacts.requirePrivateInput(source.uri)
      require(file.length() <= MAX_ATTACHMENT_BYTES) { "AI private attachment is too large." }
      Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }
  }

  private fun sourceInputStream(source: NativeAiMediaSource): InputStream = when (source) {
    is NativeAiMediaSource.Base64Value -> {
      require(source.value.length <= MAX_BASE64_CHARACTERS) { "AI base64 attachment is too large." }
      val bytes = try {
        Base64.decode(source.value, Base64.NO_WRAP)
      } catch (error: IllegalArgumentException) {
        throw IllegalArgumentException("AI base64 attachment is invalid.", error)
      }
      require(bytes.size <= MAX_ATTACHMENT_BYTES) { "AI base64 attachment is too large." }
      ByteArrayInputStream(bytes)
    }
    is NativeAiMediaSource.PrivateUri -> {
      val file = artifacts.requirePrivateInput(source.uri)
      require(file.length() <= MAX_ATTACHMENT_BYTES) { "AI private attachment is too large." }
      FileInputStream(file)
    }
  }

  private fun setJsonPointer(document: Any, pointer: String, value: String) {
    require(pointer.startsWith('/') && pointer.length > 1) { "AI attachment pointer is invalid." }
    val segments = pointer.substring(1).split('/').map { segment ->
      segment.replace("~1", "/").replace("~0", "~")
    }
    require(segments.none { it.isBlank() || it in UNSAFE_POINTER_SEGMENTS }) { "AI attachment pointer is unsafe." }
    var current: Any = document
    for (segment in segments.dropLast(1)) {
      current = when (current) {
        is JSONObject -> {
          require(current.has(segment) && !current.isNull(segment)) { "AI attachment pointer is missing." }
          current.get(segment)
        }
        is JSONArray -> current.get(arrayIndex(segment, current.length()))
        else -> throw IllegalArgumentException("AI attachment pointer is invalid.")
      }
    }
    val target = segments.last()
    when (current) {
      is JSONObject -> {
        require(current.has(target)) { "AI attachment pointer is missing." }
        current.put(target, value)
      }
      is JSONArray -> current.put(arrayIndex(target, current.length()), value)
      else -> throw IllegalArgumentException("AI attachment pointer is invalid.")
    }
  }

  private fun arrayIndex(value: String, length: Int): Int {
    require(value.matches(ARRAY_INDEX)) { "AI attachment pointer is invalid." }
    val index = value.toIntOrNull() ?: throw IllegalArgumentException("AI attachment pointer is invalid.")
    require(index in 0 until length) { "AI attachment pointer is out of range." }
    return index
  }

  private fun responseInput(connection: HttpsURLConnection, status: Int): InputStream? = try {
    if (status in 200..399) connection.inputStream else connection.errorStream ?: connection.inputStream
  } catch (error: IOException) {
    if (status >= 400) null else throw error
  }

  private fun readUtf8Bounded(input: InputStream, maxBytes: Int): String {
    val buffer = ByteArray(CHUNK_BYTES)
    var total = 0
    val output = StringBuilder()
    input.reader(StandardCharsets.UTF_8).use { reader ->
      val chars = CharArray(CHUNK_BYTES)
      while (true) {
        val count = reader.read(chars)
        if (count < 0) break
        total += String(chars, 0, count).toByteArray(StandardCharsets.UTF_8).size
        require(total <= maxBytes) { "AI response is too large." }
        output.append(chars, 0, count)
      }
    }
    return output.toString()
  }

  private fun streamUtf8(input: InputStream, onChunk: (String) -> Unit) {
    var totalBytes = 0
    input.reader(StandardCharsets.UTF_8).use { reader ->
      val chars = CharArray(CHUNK_BYTES)
      while (true) {
        val count = reader.read(chars)
        if (count < 0) break
        if (count > 0) {
          val chunk = String(chars, 0, count)
          totalBytes += chunk.toByteArray(StandardCharsets.UTF_8).size
          if (totalBytes > MAX_STREAM_RESPONSE_BYTES) {
            throw NativeAiRequestException("ERR_AI_RESPONSE_TOO_LARGE", "The AI stream response is too large.", retryable = true)
          }
          onChunk(chunk)
        }
      }
    }
  }

  private fun publicResponseHeaders(connection: HttpsURLConnection): Map<String, String> = buildMap {
    connection.headerFields.forEach { (name, values) ->
      if (name == null || values.isNullOrEmpty()) return@forEach
      val normalized = name.lowercase()
      if (!HEADER_NAME.matches(name) || normalized in SENSITIVE_RESPONSE_HEADERS) return@forEach
      val value = values.joinToString(", ")
      if (value.length <= MAX_HEADER_VALUE_LENGTH && !value.contains('\r') && !value.contains('\n') && size < MAX_RESPONSE_HEADERS) {
        put(normalized, value)
      }
    }
  }

  private fun validateMultipartField(name: String, value: String) {
    NativeNetworkPolicy.requireCredentialFreeAiMultipartField(name)
    require(value.length <= MAX_MULTIPART_FIELD_LENGTH && !value.contains('\r') && !value.contains('\n')) {
      "AI multipart field value is invalid."
    }
  }

  private fun validateFilename(value: String) {
    require(value.isNotBlank() && value.length <= 240 && !value.contains('/') && !value.contains('\\') &&
      value != "." && value != ".." && value.none { it.code < 32 || it.code == 127 || it == '"' || it == '\r' || it == '\n' }) {
      "AI multipart filename is invalid."
    }
  }

  private fun validatedMimeType(value: String): String = value.takeIf { MIME_TYPE.matches(it) }
    ?: throw IllegalArgumentException("AI attachment MIME type is invalid.")

  private fun OutputStream.writeUtf8(value: String) {
    write(value.toByteArray(StandardCharsets.UTF_8))
  }

  private companion object {
    const val RESPONSE_MODE_JSON = "json"
    const val RESPONSE_MODE_STREAM = "stream"
    const val MIN_TIMEOUT_MS = 1_000
    const val MAX_TIMEOUT_MS = 120_000
    const val CHUNK_BYTES = 8 * 1024
    const val MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
    const val MAX_BASE64_CHARACTERS = 21 * 1024 * 1024
    const val MAX_JSON_REQUEST_BYTES = 24 * 1024 * 1024
    const val MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024
    const val MAX_STREAM_RESPONSE_BYTES = 2 * 1024 * 1024
    const val MAX_RESPONSE_HEADERS = 20
    const val MAX_HEADER_VALUE_LENGTH = 512
    const val MAX_MULTIPART_FIELD_LENGTH = 4 * 1024
    val REQUEST_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
    val MIME_TYPE = Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
    val ARRAY_INDEX = Regex("0|[1-9][0-9]*")
    val HEADER_NAME = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
    val UNSAFE_POINTER_SEGMENTS = setOf("__proto__", "constructor", "prototype")
    val SENSITIVE_RESPONSE_HEADERS = setOf("set-cookie", "authorization", "proxy-authenticate", "www-authenticate")
  }
}
