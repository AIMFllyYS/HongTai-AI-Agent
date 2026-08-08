package com.hongtai.aiagent.network

import java.io.IOException
import java.net.ConnectException
import java.net.IDN
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Safe, versioned rejection data for one native page-fetch failure. */
data class NativeLinkDiagnostic(
  val operation: String,
  val phase: String,
  val hostname: String?,
  val errorClass: String,
  val elapsedMs: Long,
  val attempt: Int,
  val redirectCount: Int,
) {
  val schemaVersion: String = SCHEMA_VERSION

  init {
    require(operation in OPERATIONS) { "Native link diagnostic operation is invalid." }
    require(phase in PHASES) { "Native link diagnostic phase is invalid." }
    require(errorClass in ERROR_CLASSES) { "Native link diagnostic error class is invalid." }
    require(elapsedMs in 0..MAX_ELAPSED_MS) { "Native link diagnostic elapsed time is invalid." }
    require(attempt in 1..MAX_ATTEMPTS) { "Native link diagnostic attempt is invalid." }
    require(redirectCount in 0..MAX_REDIRECTS) { "Native link diagnostic redirect count is invalid." }
    require(hostname == null || safeHostname(hostname) == hostname) { "Native link diagnostic hostname is invalid." }
  }

  /** Exact allowlist used as Capacitor rejection data. */
  fun toSafeData(): Map<String, Any> = buildMap {
    put("schemaVersion", schemaVersion)
    put("operation", operation)
    put("phase", phase)
    if (hostname != null) put("hostname", hostname)
    put("errorClass", errorClass)
    put("elapsedMs", elapsedMs)
    put("attempt", attempt)
    put("redirectCount", redirectCount)
  }

  internal companion object {
    const val SCHEMA_VERSION = "native-link-diagnostic.v1"
    const val MAX_ELAPSED_MS = 600_000L
    const val MAX_ATTEMPTS = 3
    const val MAX_REDIRECTS = 5
    val OPERATIONS = setOf("fetch-text")
    val PHASES = setOf("request", "connect", "redirect", "response", "decode")
    val ERROR_CLASSES = setOf(
      "dns",
      "tls",
      "connection",
      "timeout",
      "redirect_limit",
      "redirect_invalid",
      "response_too_large",
      "response_invalid_encoding",
      "response_io",
      "invalid_request",
    )

    fun safeHostname(value: String?): String? {
      val normalized = try {
        IDN.toASCII(value?.trim()?.lowercase().orEmpty()).trimEnd('.')
      } catch (_: IllegalArgumentException) {
        return null
      }
      if (normalized.length !in 1..253 || ':' in normalized) return null
      val labels = normalized.split('.')
      if (labels.size < 2 || labels.all { label -> label.all(Char::isDigit) }) return null
      if (labels.any { label -> !HOST_LABEL.matches(label) }) return null
      return normalized
    }

    private val HOST_LABEL = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
  }
}

class NativeLinkFailureContext private constructor(
  val phase: String,
  val hostname: String?,
  val elapsedMs: Long,
  val attempt: Int,
  val redirectCount: Int,
) {
  companion object {
    fun safe(
      phase: String,
      hostname: String?,
      elapsedMs: Long,
      attempt: Int,
      redirectCount: Int,
    ): NativeLinkFailureContext {
      require(phase in NativeLinkDiagnostic.PHASES) { "Native link failure phase is invalid." }
      require(attempt in 1..NativeLinkDiagnostic.MAX_ATTEMPTS) { "Native link failure attempt is invalid." }
      require(redirectCount in 0..NativeLinkDiagnostic.MAX_REDIRECTS) { "Native link failure redirect count is invalid." }
      return NativeLinkFailureContext(
        phase = phase,
        hostname = NativeLinkDiagnostic.safeHostname(hostname),
        elapsedMs = elapsedMs.coerceIn(0, NativeLinkDiagnostic.MAX_ELAPSED_MS),
        attempt = attempt,
        redirectCount = redirectCount,
      )
    }
  }
}

/** Pure classifier: it never copies Throwable messages, stack traces, URLs, or response bodies. */
object NativeLinkFailureClassifier {
  fun classify(error: Throwable, context: NativeLinkFailureContext): NativeNetworkException {
    val classification = when (error) {
      is NativeNetworkException -> nativeClassification(error)
      is UnknownHostException -> Classification(
        code = "ERR_LINK_DNS_FAILED",
        userMessage = "The page host could not be resolved.",
        retryable = true,
        errorClass = "dns",
      )
      is SSLException -> Classification(
        code = "ERR_LINK_TLS_FAILED",
        userMessage = "The page TLS connection could not be established.",
        retryable = true,
        errorClass = "tls",
      )
      is SocketTimeoutException -> Classification(
        code = "ERR_LINK_TIMEOUT",
        userMessage = "The page fetch timed out.",
        retryable = true,
        errorClass = "timeout",
      )
      is ConnectException, is NoRouteToHostException -> Classification(
        code = "ERR_LINK_CONNECTION_FAILED",
        userMessage = "The page connection could not be established.",
        retryable = true,
        errorClass = "connection",
      )
      is ProtocolException, is IOException -> Classification(
        code = "ERR_LINK_RESPONSE_FAILED",
        userMessage = "The page response could not be read safely.",
        retryable = true,
        errorClass = "response_io",
      )
      else -> Classification(
        code = "ERR_LINK_RESPONSE_FAILED",
        userMessage = "The page response could not be processed safely.",
        retryable = true,
        errorClass = "response_io",
      )
    }
    return NativeNetworkException(
      code = classification.code,
      userMessage = classification.userMessage,
      retryable = classification.retryable,
      diagnostic = NativeLinkDiagnostic(
        operation = "fetch-text",
        phase = phaseFor(classification.errorClass, context.phase),
        hostname = context.hostname,
        errorClass = classification.errorClass,
        elapsedMs = context.elapsedMs,
        attempt = context.attempt,
        redirectCount = context.redirectCount,
      ),
    )
  }

  private fun nativeClassification(error: NativeNetworkException): Classification = when (error.code) {
    "ERR_LINK_REDIRECT_LIMIT" -> Classification(error.code, error.userMessage, error.retryable, "redirect_limit")
    "ERR_LINK_REDIRECT_INVALID" -> Classification(error.code, error.userMessage, error.retryable, "redirect_invalid")
    "ERR_LINK_RESPONSE_TOO_LARGE" -> Classification(error.code, error.userMessage, error.retryable, "response_too_large")
    "ERR_LINK_RESPONSE_INVALID" -> Classification(error.code, error.userMessage, error.retryable, "response_invalid_encoding")
    "ERR_LINK_REQUEST_INVALID" -> Classification(error.code, error.userMessage, error.retryable, "invalid_request")
    "ERR_LINK_DNS_FAILED" -> Classification(error.code, error.userMessage, error.retryable, "dns")
    "ERR_LINK_TLS_FAILED" -> Classification(error.code, error.userMessage, error.retryable, "tls")
    "ERR_LINK_CONNECTION_FAILED" -> Classification(error.code, error.userMessage, error.retryable, "connection")
    "ERR_LINK_TIMEOUT" -> Classification(error.code, error.userMessage, error.retryable, "timeout")
    "ERR_LINK_RESPONSE_FAILED" -> Classification(error.code, error.userMessage, error.retryable, "response_io")
    else -> Classification(
      code = "ERR_LINK_RESPONSE_FAILED",
      userMessage = "The page response could not be processed safely.",
      retryable = true,
      errorClass = "response_io",
    )
  }

  private fun phaseFor(errorClass: String, fallback: String): String = when (errorClass) {
    "dns", "tls", "connection" -> "connect"
    "redirect_limit", "redirect_invalid" -> "redirect"
    "response_invalid_encoding" -> "decode"
    "response_too_large", "response_io" -> "response"
    else -> fallback
  }

  private data class Classification(
    val code: String,
    val userMessage: String,
    val retryable: Boolean,
    val errorClass: String,
  )
}
