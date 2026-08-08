package com.hongtai.aiagent.network

import java.io.IOException
import java.net.ConnectException
import java.net.ProtocolException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class NativeLinkFailureClassifierTest {
  @Test
  fun `classifies expected fetch failures into stable ERR LINK codes`() {
    val cases = listOf(
      UnknownHostException("https://www.example.test/page?token=secret") to "ERR_LINK_DNS_FAILED",
      SSLHandshakeException("certificate detail must not cross the bridge") to "ERR_LINK_TLS_FAILED",
      ConnectException("connection detail must not cross the bridge") to "ERR_LINK_CONNECTION_FAILED",
      SocketTimeoutException("timeout detail must not cross the bridge") to "ERR_LINK_TIMEOUT",
      ProtocolException("response detail must not cross the bridge") to "ERR_LINK_RESPONSE_FAILED",
      IOException("response detail must not cross the bridge") to "ERR_LINK_RESPONSE_FAILED",
    )

    for ((throwable, expectedCode) in cases) {
      val failure = NativeLinkFailureClassifier.classify(throwable, context())

      assertEquals(expectedCode, failure.code)
      assertEquals("native-link-diagnostic.v1", failure.diagnostic?.schemaVersion)
      assertNull(failure.cause)
    }
  }

  @Test
  fun `preserves redirect and bounded response classifications with safe diagnostics`() {
    val cases = listOf(
      NativeNetworkException("ERR_LINK_REDIRECT_LIMIT", "safe", retryable = false) to "redirect_limit",
      NativeNetworkException("ERR_LINK_REDIRECT_INVALID", "safe", retryable = false) to "redirect_invalid",
      NativeNetworkException("ERR_LINK_RESPONSE_TOO_LARGE", "safe", retryable = false) to "response_too_large",
      NativeNetworkException("ERR_LINK_RESPONSE_INVALID", "safe", retryable = false) to "response_invalid_encoding",
    )

    for ((failure, expectedClass) in cases) {
      val classified = NativeLinkFailureClassifier.classify(failure, context(phase = "response"))

      assertEquals(failure.code, classified.code)
      assertEquals(expectedClass, classified.diagnostic?.errorClass)
      assertEquals(false, classified.retryable)
    }
  }

  @Test
  fun `keeps the observed phase for timeouts while connection failures stay in connect`() {
    val timeout = NativeLinkFailureClassifier.classify(
      SocketTimeoutException("response body timeout"),
      context(phase = "response"),
    )
    val connection = NativeLinkFailureClassifier.classify(
      ConnectException("connect failed"),
      context(phase = "response"),
    )

    assertEquals("response", timeout.diagnostic?.phase)
    assertEquals("connect", connection.diagnostic?.phase)
  }

  @Test
  fun `diagnostic data contains only the versioned allowlist and omits IPs and throwable text`() {
    val context = NativeLinkFailureContext.safe(
      phase = "connect",
      hostname = "192.0.2.42",
      elapsedMs = 1_234,
      attempt = 2,
      redirectCount = 1,
    )
    val failure = NativeLinkFailureClassifier.classify(
      UnknownHostException("Cookie=session-secret Authorization=Bearer-secret https://host/path?query-secret"),
      context,
    )
    val data = checkNotNull(failure.diagnostic).toSafeData()
    val serialized = JSONObject(data).toString()

    assertEquals(
      setOf("schemaVersion", "operation", "phase", "errorClass", "elapsedMs", "attempt", "redirectCount"),
      data.keys,
    )
    assertFalse(serialized.contains("192.0.2.42"))
    assertFalse(serialized.contains("session-secret"))
    assertFalse(serialized.contains("Bearer-secret"))
    assertFalse(serialized.contains("query-secret"))
  }

  private fun context(phase: String = "connect") = NativeLinkFailureContext.safe(
    phase = phase,
    hostname = "www.example.test",
    elapsedMs = 321,
    attempt = 1,
    redirectCount = 0,
  )
}
