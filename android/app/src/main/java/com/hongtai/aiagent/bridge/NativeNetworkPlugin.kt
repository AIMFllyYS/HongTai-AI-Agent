package com.hongtai.aiagent.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.media.PrivateArtifactStore
import com.hongtai.aiagent.network.NativeAiJsonAttachment
import com.hongtai.aiagent.network.NativeAiMediaSource
import com.hongtai.aiagent.network.NativeAiMultipartFile
import com.hongtai.aiagent.network.NativeAiRequest
import com.hongtai.aiagent.network.NativeAiRequestBody
import com.hongtai.aiagent.network.NativeAiRequestClient
import com.hongtai.aiagent.network.NativeAiRequestException
import com.hongtai.aiagent.network.NativeDownloadArtifactSlot
import com.hongtai.aiagent.network.NativeDownloadClient
import com.hongtai.aiagent.network.NativeDownloadProgress
import com.hongtai.aiagent.network.NativeDownloadRequest
import com.hongtai.aiagent.network.NativeNetworkException
import com.hongtai.aiagent.network.NativeNetworkPolicy
import com.hongtai.aiagent.network.NativeTextFetchClient
import com.hongtai.aiagent.network.NativeTextFetchRequest
import com.hongtai.aiagent.storage.AndroidKeystoreSecretStore
import com.hongtai.aiagent.storage.LocalPreferences
import com.hongtai.aiagent.storage.SecureStorageException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native-only transport boundary. Downloads are real HTTPS operations and
 * complete only after a private file reaches fsync+rename. The plugin still
 * does not parse platform content or report a fabricated task-stage result.
 */
@CapacitorPlugin(name = "NativeNetwork")
class NativeNetworkPlugin : Plugin() {
  private val downloads: NativeDownloadClient by lazy { NativeDownloadClient(PrivateArtifactStore(context)) }
  private val textFetches: NativeTextFetchClient by lazy { NativeTextFetchClient() }
  private val aiRequests: NativeAiRequestClient by lazy { NativeAiRequestClient(PrivateArtifactStore(context)) }
  private val secureSecrets: AndroidKeystoreSecretStore by lazy { AndroidKeystoreSecretStore(context) }
  private val localPreferences: LocalPreferences by lazy { LocalPreferences(context) }

  @PluginMethod
  fun getCapabilities(call: PluginCall) {
    call.resolve(
      JSObject()
        .put("fetchText", "available")
        .put("download", "available")
        // Capability means this native transport exists. Whether the one
        // local connection has a valid Base URL/Key is configuration state
        // and must surface only when a real request/probe is attempted.
        .put("ai", "available"),
    )
  }

  /**
   * Short-lived HTML/JSON fetch for TypeScript platform adapters. The result
   * is never persisted natively and the bridge offers no generic URL proxy.
   */
  @PluginMethod
  fun fetchText(call: PluginCall) {
    val request = try {
      NativeTextFetchRequest(
        method = call.requiredKnown("method", FETCH_METHODS),
        url = call.requiredString("url"),
        headers = call.optionalFetchHeaders(),
        body = call.optionalFetchBody(),
        maxRedirects = call.optionalFetchInt("maxRedirects", 0, 5),
        timeoutMs = call.optionalFetchInt("timeoutMs", 1_000, 120_000),
        maxAttempts = call.optionalFetchInt("maxAttempts", 1, 3),
      ).also { candidate ->
        NativeNetworkPolicy.requireHttpsUrl(candidate.url, "page fetch source")
        val headers = NativeNetworkPolicy.sanitizeFetchHeaders(candidate.headers)
        NativeNetworkPolicy.requireFetchRequest(candidate.method, candidate.body, headers)
      }
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "Invalid page fetch input.", NativeIssueCode.INVALID_ARGUMENT, error)
      return
    }

    NETWORK_EXECUTOR.execute {
      try {
        val result = textFetches.fetch(request)
        call.resolve(
          JSObject()
            .put("finalUrl", result.finalUrl)
            .put("status", result.status)
            .put("headers", result.headers.toJsObject())
            .put("body", result.body),
        )
      } catch (error: NativeNetworkException) {
        call.reject(error.userMessage, error.code, error)
      } catch (error: Exception) {
        call.reject("The page fetch could not finish safely.", "PAGE_FETCH_FAILED", error)
      }
    }
  }

  /**
   * Completion-based private download for the active app session. The shared
   * TypeScript pipeline owns task state; this plugin does not register a
   * foreground service, background runner, or recovery task.
   */
  @PluginMethod
  fun download(call: PluginCall) {
    val request = try {
      NativeDownloadRequest(
        taskId = call.requiredString("taskId"),
        sourceUrl = call.requiredString("sourceUrl"),
        artifact = call.requiredDownloadArtifact(),
        headers = call.optionalDownloadHeaders(),
      ).also { candidate ->
        NativeNetworkPolicy.requireHttpsUrl(candidate.sourceUrl, "download source")
        NativeNetworkPolicy.sanitizeDownloadHeaders(candidate.headers)
      }
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "Invalid native download input.", NativeIssueCode.INVALID_ARGUMENT, error)
      return
    }

    NETWORK_EXECUTOR.execute {
      try {
        val result = downloads.download(request) { progress -> emitDownloadProgress(request, progress) }
        call.resolve(
          JSObject()
            .put("taskId", result.taskId)
            .put("uri", result.uri)
            .put("sizeBytes", result.sizeBytes)
            .putOptional("mimeType", result.mimeType),
        )
      } catch (error: NativeNetworkException) {
        call.reject(error.userMessage, error.code, error)
      } catch (error: Exception) {
        val safe = NativeNetworkException(
          code = "MEDIA_DOWNLOAD_FAILED",
          userMessage = "The media download could not finish safely.",
          retryable = true,
          cause = error,
        )
        call.reject(safe.userMessage, safe.code, safe)
      }
    }
  }

  private fun emitDownloadProgress(request: NativeDownloadRequest, progress: NativeDownloadProgress) {
    val artifact = JSObject()
      .put("kind", request.artifact.kind)
      .putOptional("index", request.artifact.index)
    notifyListeners(
      "downloadProgress",
      JSObject()
        .put("taskId", request.taskId)
        .put("artifact", artifact)
        .put("downloadedBytes", progress.downloadedBytes)
        .putOptional("totalBytes", progress.totalBytes)
        .putOptional("progress", progress.progress),
    )
  }

  /**
   * Starts one credential-safe OpenAI-compatible request. The WebView can
   * provide only a relative endpoint plus a protocol body; the active Base
   * URL is read from local public preferences and the API key is decrypted in native memory
   * immediately before the HTTPS request is written.
   */
  @PluginMethod
  fun startAiRequest(call: PluginCall) {
    val request = try {
      call.toNativeAiRequest().also { candidate ->
        NativeNetworkPolicy.sanitizeAiHeaders(candidate.headers)
      }
    } catch (error: IllegalArgumentException) {
      call.reject(error.message ?: "Invalid AI transport request.", NativeIssueCode.INVALID_ARGUMENT, error)
      return
    }
    val responseStarted = AtomicBoolean(false)
    val sequence = AtomicLong(0L)
    AI_EXECUTOR.execute {
      try {
        val connection = localPreferences.readAiConnection()
          ?: throw NativeAiRequestException("ERR_AI_NOT_CONFIGURED", "AI connection settings are not configured.")
        if (!secureSecrets.hasActiveAiConnectionSecret()) {
          throw NativeAiRequestException("ERR_SECURE_STORAGE_UNAVAILABLE", "The protected AI credential is unavailable.")
        }
        secureSecrets.withActiveAiConnectionSecret { apiKey ->
          aiRequests.execute(
            request = request,
            baseUrl = connection.baseUrl,
            apiKey = apiKey,
            onHeaders = { response ->
              responseStarted.set(true)
              call.resolve(
                JSObject()
                  .put("requestId", request.requestId)
                  .put("accepted", true)
                  .put("status", response.status)
                  .put("headers", response.headers.toJsObject()),
              )
            },
            onChunk = { chunk ->
              emitAiChunk(request.requestId, sequence.incrementAndGet(), chunk)
            },
            onCompleted = { bodyText ->
              emitAiCompleted(request.requestId, sequence.incrementAndGet(), bodyText)
            },
          )
        }
      } catch (error: NativeAiRequestException) {
        settleAiFailure(call, request.requestId, responseStarted.get(), sequence.incrementAndGet(), error)
      } catch (error: IllegalStateException) {
        settleAiFailure(
          call,
          request.requestId,
          responseStarted.get(),
          sequence.incrementAndGet(),
          NativeAiRequestException("ERR_LOCAL_DATA_UNAVAILABLE", "The local AI settings are unavailable.", cause = error),
        )
      } catch (error: SecureStorageException) {
        settleAiFailure(
          call,
          request.requestId,
          responseStarted.get(),
          sequence.incrementAndGet(),
          NativeAiRequestException("ERR_SECURE_STORAGE_UNAVAILABLE", "The protected AI credential is unavailable.", cause = error),
        )
      } catch (error: IllegalArgumentException) {
        settleAiFailure(
          call,
          request.requestId,
          responseStarted.get(),
          sequence.incrementAndGet(),
          NativeAiRequestException("ERR_AI_REQUEST_INVALID", "The AI request could not be prepared safely.", cause = error),
        )
      } catch (error: Exception) {
        settleAiFailure(
          call,
          request.requestId,
          responseStarted.get(),
          sequence.incrementAndGet(),
          NativeAiRequestException("ERR_AI_NETWORK_FAILED", "The AI request could not finish safely.", retryable = true, cause = error),
        )
      }
    }
  }

  private fun settleAiFailure(
    call: PluginCall,
    requestId: String,
    responseStarted: Boolean,
    eventSequence: Long,
    error: NativeAiRequestException,
  ) {
    if (responseStarted) {
      emitAiFailed(requestId, eventSequence, error)
    } else {
      call.reject(error.userMessage, error.code, error)
    }
  }

  private fun emitAiChunk(requestId: String, eventSequence: Long, chunk: String) {
    notifyListeners(
      "aiRequestEvent",
      JSObject()
        .put("type", "chunk")
        .put("requestId", requestId)
        .put("sequence", eventSequence)
        .put("chunk", chunk),
    )
  }

  private fun emitAiCompleted(requestId: String, eventSequence: Long, bodyText: String?) {
    notifyListeners(
      "aiRequestEvent",
      JSObject()
        .put("type", "completed")
        .put("requestId", requestId)
        .put("sequence", eventSequence)
        .putOptional("bodyText", bodyText),
    )
  }

  private fun emitAiFailed(requestId: String, eventSequence: Long, error: NativeAiRequestException) {
    notifyListeners(
      "aiRequestEvent",
      JSObject()
        .put("type", "failed")
        .put("requestId", requestId)
        .put("sequence", eventSequence)
        .put("code", error.code)
        .put("userMessage", error.userMessage)
        .put("retryable", error.retryable),
    )
  }

  private fun PluginCall.toNativeAiRequest(): NativeAiRequest {
    require(requiredString("version") == "ai-transport.v1") { "AI transport version is invalid." }
    require(requiredString("method") == "POST") { "AI transport method is invalid." }
    val responseMode = requiredString("responseMode")
    require(responseMode == "json" || responseMode == "stream") { "AI response mode is invalid." }
    return NativeAiRequest(
      requestId = requiredString("requestId"),
      relativePath = requiredString("relativePath"),
      headers = optionalAiHeaders(),
      body = data.requiredObject("body").toNativeAiBody(),
      responseMode = responseMode,
      timeoutMs = optionalTimeoutMs(),
    )
  }

  private fun JSONObject.toNativeAiBody(): NativeAiRequestBody = when (requiredString("kind")) {
    "json" -> NativeAiRequestBody.Json(
      json = requiredString("json"),
      attachments = optionalArray("attachments")?.toJsonAttachments() ?: emptyList(),
    )
    "multipart" -> NativeAiRequestBody.Multipart(
      fields = requiredObject("fields").toStringMap("fields"),
      file = requiredObject("file").toMultipartFile(),
    )
    else -> throw IllegalArgumentException("AI request body kind is invalid.")
  }

  private fun JSONArray.toJsonAttachments(): List<NativeAiJsonAttachment> = buildList {
    require(length() <= MAX_AI_ATTACHMENTS) { "Too many AI attachments." }
    for (index in 0 until length()) {
      val attachment = opt(index) as? JSONObject ?: throw IllegalArgumentException("AI attachment is invalid.")
      add(
        NativeAiJsonAttachment(
          pointer = attachment.requiredString("pointer"),
          source = attachment.requiredObject("source").toAiMediaSource(),
          mimeType = attachment.requiredString("mimeType"),
          materialization = attachment.requiredString("materialization"),
        ),
      )
    }
  }

  private fun JSONObject.toMultipartFile(): NativeAiMultipartFile = NativeAiMultipartFile(
    filename = requiredString("filename"),
    mimeType = requiredString("mimeType"),
    source = requiredObject("source").toAiMediaSource(),
  )

  private fun JSONObject.toAiMediaSource(): NativeAiMediaSource = when (requiredString("kind")) {
    "base64" -> NativeAiMediaSource.Base64Value(requiredString("base64"))
    "uri" -> NativeAiMediaSource.PrivateUri(requiredString("uri"))
    else -> throw IllegalArgumentException("AI media source is invalid.")
  }

  private fun PluginCall.optionalAiHeaders(): Map<String, String> {
    if (!data.has("headers") || data.isNull("headers")) return emptyMap()
    return data.requiredObject("headers").toStringMap("headers")
  }

  private fun PluginCall.optionalTimeoutMs(): Int {
    if (!data.has("timeoutMs") || data.isNull("timeoutMs")) return DEFAULT_AI_TIMEOUT_MS
    val number = data.opt("timeoutMs") as? Number ?: throw IllegalArgumentException("AI timeout is invalid.")
    return number.toInt().also { value ->
      require(number.toDouble() == value.toDouble() && value in MIN_AI_TIMEOUT_MS..MAX_AI_TIMEOUT_MS) {
        "AI timeout is invalid."
      }
    }
  }

  private fun JSONObject.toStringMap(label: String): Map<String, String> = buildMap {
    require(length() <= MAX_AI_HEADERS_OR_FIELDS) { "$label contains too many values." }
    val keys = keys()
    while (keys.hasNext()) {
      val name = keys.next()
      val value = opt(name) as? String ?: throw IllegalArgumentException("$label contains an invalid value.")
      put(name, value)
    }
  }

  private fun JSONObject.requiredString(name: String): String = optString(name, "")
    .takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("$name is required.")

  private fun JSONObject.requiredObject(name: String): JSONObject = optJSONObject(name)
    ?: throw IllegalArgumentException("$name is required.")

  private fun JSONObject.optionalArray(name: String): JSONArray? = if (has(name) && !isNull(name)) {
    optJSONArray(name) ?: throw IllegalArgumentException("$name is invalid.")
  } else {
    null
  }

  private fun PluginCall.requiredString(name: String): String = getString(name)?.takeIf { it.isNotBlank() }
    ?: throw IllegalArgumentException("$name is required.")

  private fun PluginCall.requiredKnown(name: String, allowed: Set<String>): String = requiredString(name).also {
    require(it in allowed) { "$name is invalid." }
  }

  private fun PluginCall.optionalDownloadHeaders(): Map<String, String> {
    if (!data.has("headers") || data.isNull("headers")) return emptyMap()
    val headers = data.optJSONObject("headers") ?: throw IllegalArgumentException("headers are invalid.")
    return buildMap {
      val keys = headers.keys()
      while (keys.hasNext()) {
        val name = keys.next()
        val value = headers.opt(name) as? String ?: throw IllegalArgumentException("headers are invalid.")
        put(name, value)
      }
    }
  }

  private fun PluginCall.optionalFetchHeaders(): Map<String, String> {
    if (!data.has("headers") || data.isNull("headers")) return emptyMap()
    val headers = data.optJSONObject("headers") ?: throw IllegalArgumentException("headers are invalid.")
    return headers.toStringMap("headers")
  }

  private fun PluginCall.optionalFetchBody(): String? {
    if (!data.has("body") || data.isNull("body")) return null
    return data.opt("body") as? String ?: throw IllegalArgumentException("body is invalid.")
  }

  private fun PluginCall.optionalFetchInt(name: String, min: Int, max: Int): Int? {
    if (!data.has(name) || data.isNull(name)) return null
    val number = data.opt(name) as? Number ?: throw IllegalArgumentException("$name is invalid.")
    return number.toInt().also { value ->
      require(number.toDouble() == value.toDouble() && value in min..max) { "$name is invalid." }
    }
  }

  private fun PluginCall.requiredDownloadArtifact(): NativeDownloadArtifactSlot {
    val artifact = data.optJSONObject("artifact") ?: throw IllegalArgumentException("artifact is required.")
    val kind = artifact.optString("kind", "")
    val index = if (kind == "image") {
      val indexValue = artifact.opt("index") as? Number ?: throw IllegalArgumentException("artifact index is invalid.")
      indexValue.toInt().also { parsed -> require(indexValue.toDouble() == parsed.toDouble()) { "artifact index is invalid." } }
    } else {
      require(!artifact.has("index") || artifact.isNull("index")) { "artifact index is invalid." }
      null
    }
    return NativeDownloadArtifactSlot(kind = kind, index = index)
  }

  private fun JSObject.putOptional(name: String, value: Any?): JSObject = apply {
    if (value != null) put(name, value)
  }

  private fun Map<String, String>.toJsObject(): JSObject = JSObject().also { target ->
    forEach { (name, value) -> target.put(name, value) }
  }

  private companion object {
    const val DEFAULT_AI_TIMEOUT_MS = 90_000
    const val MIN_AI_TIMEOUT_MS = 1_000
    const val MAX_AI_TIMEOUT_MS = 120_000
    const val MAX_AI_ATTACHMENTS = 8
    const val MAX_AI_HEADERS_OR_FIELDS = 16
    val FETCH_METHODS = setOf("GET", "POST")
    val NETWORK_EXECUTOR = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "hongtai-native-network").apply { isDaemon = true }
    }
    val AI_EXECUTOR = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "hongtai-native-ai-transport").apply { isDaemon = true }
    }
  }
}
