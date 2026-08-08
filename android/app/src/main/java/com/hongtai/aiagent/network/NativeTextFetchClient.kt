package com.hongtai.aiagent.network

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import javax.net.ssl.HttpsURLConnection

/**
 * Bounded HTTPS page fetch for the shared TypeScript platform adapters. Its
 * response body is deliberately returned only in memory; this class never
 * writes page HTML/JSON to local preferences, a task artifact, or a user-visible view.
 */
class NativeTextFetchClient {
  fun fetch(request: NativeTextFetchRequest): NativeTextFetchResult {
    val headers = NativeNetworkPolicy.sanitizeFetchHeaders(request.headers)
    NativeNetworkPolicy.requireFetchRequest(request.method, request.body, headers)
    val options = request.options()
    var lastFailure: NativeNetworkException? = null
    for (attempt in 1..options.maxAttempts) {
      try {
        return fetchOnce(request, headers, options, attempt)
      } catch (error: NativeNetworkException) {
        lastFailure = error
        if (!error.retryable || attempt == options.maxAttempts) throw error
      }
    }
    throw checkNotNull(lastFailure)
  }

  private fun fetchOnce(
    request: NativeTextFetchRequest,
    headers: Map<String, String>,
    options: FetchOptions,
    attempt: Int,
  ): NativeTextFetchResult {
    val startedAtNanos = System.nanoTime()
    var target = NativeNetworkPolicy.requireHttpsUrl(request.url, "page fetch source")
    var redirects = 0
    var phase = "request"
    try {
      while (true) {
        NativeNetworkPolicy.requirePublicNetworkTarget(target, "page fetch source")
        val connection = (target.openConnection() as? HttpsURLConnection)
          ?: throw NativeNetworkException("ERR_LINK_REQUEST_INVALID", "The page source is not HTTPS.")
        try {
          connection.instanceFollowRedirects = false
          connection.requestMethod = request.method
          connection.connectTimeout = options.timeoutMs
          connection.readTimeout = options.timeoutMs
          connection.setRequestProperty("Accept-Encoding", "identity")
          headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
          if (request.method == "POST") {
            val body = requireNotNull(request.body)
            connection.doOutput = true
            connection.outputStream.use { output ->
              output.write(body.toByteArray(Charsets.UTF_8))
              output.flush()
            }
          }

          phase = "connect"
          val status = connection.responseCode
          if (status in REDIRECT_STATUS_CODES) {
            phase = "redirect"
            if (redirects >= options.maxRedirects) {
              throw NativeNetworkException("ERR_LINK_REDIRECT_LIMIT", "The page source redirected too many times.")
            }
            val location = connection.getHeaderField("Location")?.trim().orEmpty()
            if (location.isBlank()) {
              throw NativeNetworkException("ERR_LINK_REDIRECT_INVALID", "The page source returned an invalid redirect.")
            }
            target = NativeNetworkPolicy.requireHttpsUrl(URL(target, location).toExternalForm(), "page fetch redirect")
            redirects += 1
            continue
          }

          phase = "response"
          val bodyStream = if (status >= HttpURLConnection.HTTP_BAD_REQUEST) connection.errorStream else connection.inputStream
          val body = bodyStream?.use(::readBoundedUtf8) ?: ""
          return NativeTextFetchResult(
            finalUrl = target.toExternalForm(),
            status = status,
            headers = NativeNetworkPolicy.sanitizeResponseHeaders(connection.headerFields),
            body = body,
          )
        } finally {
          connection.disconnect()
        }
      }
    } catch (error: IllegalArgumentException) {
      throw NativeLinkFailureClassifier.classify(
        NativeNetworkException("ERR_LINK_REQUEST_INVALID", "The page fetch could not be prepared safely."),
        failureContext(phase, target, startedAtNanos, attempt, redirects),
      )
    } catch (error: Throwable) {
      throw NativeLinkFailureClassifier.classify(
        error,
        failureContext(phase, target, startedAtNanos, attempt, redirects),
      )
    }
  }

  private fun failureContext(
    phase: String,
    target: URL,
    startedAtNanos: Long,
    attempt: Int,
    redirects: Int,
  ): NativeLinkFailureContext = NativeLinkFailureContext.safe(
    phase = phase,
    hostname = target.host,
    elapsedMs = ((System.nanoTime() - startedAtNanos) / 1_000_000L).coerceAtLeast(0),
    attempt = attempt,
    redirectCount = redirects,
  )

  private fun NativeTextFetchRequest.options(): FetchOptions = FetchOptions(
    maxRedirects = (maxRedirects ?: MAX_REDIRECTS).also { value ->
      require(value in 0..MAX_REDIRECTS) { "Page fetch redirect limit is invalid." }
    },
    timeoutMs = (timeoutMs ?: READ_TIMEOUT_MS).also { value ->
      require(value in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) { "Page fetch timeout is invalid." }
    },
    maxAttempts = (maxAttempts ?: DEFAULT_MAX_ATTEMPTS).also { value ->
      require(value in 1..MAX_ATTEMPTS) { "Page fetch attempt count is invalid." }
    },
  )

  private fun readBoundedUtf8(input: java.io.InputStream): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(BUFFER_BYTES)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      if (output.size() + count > MAX_RESPONSE_BYTES) {
        throw NativeNetworkException("ERR_LINK_RESPONSE_TOO_LARGE", "The page response is larger than the parser limit.")
      }
      output.write(buffer, 0, count)
    }
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(output.toByteArray()))
        .toString()
    } catch (error: Exception) {
      throw NativeNetworkException("ERR_LINK_RESPONSE_INVALID", "The page response is not valid UTF-8.")
    }
  }

  private companion object {
    const val READ_TIMEOUT_MS = 30_000
    const val MIN_TIMEOUT_MS = 1_000
    const val MAX_TIMEOUT_MS = 120_000
    const val MAX_REDIRECTS = 5
    const val DEFAULT_MAX_ATTEMPTS = 1
    const val MAX_ATTEMPTS = 3
    const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    const val BUFFER_BYTES = 32 * 1024
    val REDIRECT_STATUS_CODES = setOf(301, 302, 303, 307, 308)
  }

  private data class FetchOptions(
    val maxRedirects: Int,
    val timeoutMs: Int,
    val maxAttempts: Int,
  )
}
