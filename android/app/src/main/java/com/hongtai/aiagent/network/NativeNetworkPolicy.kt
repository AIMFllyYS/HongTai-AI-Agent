package com.hongtai.aiagent.network

import java.net.InetAddress
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Rejects network targets that would let a WebView-provided value escape the
 * user-configured HTTPS endpoint or turn the native bridge into a file/cleartext
 * fetch proxy. Platform parsing remains in TypeScript; this is transport-only
 * validation at the Android boundary.
 */
internal object NativeNetworkPolicy {
  private val safePathSegment = Regex("[A-Za-z0-9._~!$&'()*+,;=:@%-]+")
  private val safeHeaderName = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
  private val allowedDownloadHeaders = setOf("accept", "accept-language", "referer", "user-agent")
  private val allowedFetchHeaders = setOf("user-agent", "referer", "accept", "accept-language", "origin", "content-type")
  private val allowedResponseHeaders = setOf("content-type", "content-length", "etag", "last-modified", "cache-control", "x-request-id")
  private val forbiddenAiHeaders = setOf(
    "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "api_key",
    "x-auth-token", "x-access-token", "host", "content-length", "connection", "transfer-encoding", "upgrade",
  )
  private val forbiddenAiBodyFieldNames = setOf(
    "authorization", "proxy-authorization", "cookie", "set-cookie",
    "x-api-key", "api-key", "api_key", "apikey",
    "x-auth-token", "x-access-token", "access_token", "token",
  )

  fun requireHttpsUrl(value: String, label: String): URL {
    val url = try {
      URL(value.trim())
    } catch (error: Exception) {
      throw IllegalArgumentException("$label must be a valid HTTPS URL.", error)
    }
    require(url.protocol.equals("https", ignoreCase = true)) { "$label must use HTTPS." }
    require(!url.host.isNullOrBlank()) { "$label must include a host." }
    require(url.userInfo.isNullOrBlank()) { "$label must not include credentials." }
    return url
  }

  /**
   * Checks the resolved host immediately before a native connection. This
   * blocks loopback, link-local, multicast and private-space targets so the
   * WebView cannot use the downloader or AI transport as a LAN proxy.
   */
  fun requirePublicNetworkTarget(url: URL, label: String): URL {
    val host = url.host.trim().removePrefix("[").removeSuffix("]")
    require(host.isNotBlank() && !host.equals("localhost", ignoreCase = true) && !host.endsWith(".local", ignoreCase = true)) {
      "$label must not target a local network host."
    }
    val addresses = try {
      InetAddress.getAllByName(host)
    } catch (error: Exception) {
      throw IllegalArgumentException("$label host could not be resolved.", error)
    }
    require(addresses.isNotEmpty() && addresses.none(::isPrivateOrLocalAddress)) {
      "$label must not target a private or local network address."
    }
    return url
  }

  /**
   * Platform parsing can provide display/request hints, but this native
   * transport accepts only a small, credential-free header subset.
   */
  fun sanitizeDownloadHeaders(headers: Map<String, String>): Map<String, String> = buildMap {
    require(headers.size <= 4) { "Too many download headers." }
    headers.forEach { (name, value) ->
      val normalized = name.lowercase()
      require(safeHeaderName.matches(name) && normalized in allowedDownloadHeaders) {
        "Download header is not allowed."
      }
      require(value.length <= 512 && !value.contains('\r') && !value.contains('\n')) {
        "Download header value is invalid."
      }
      put(normalized, value)
    }
  }

  /**
   * Page fetching is a narrow parser input, not a general native proxy. The
   * Kuaishou adapter additionally needs Origin and JSON Content-Type for its
   * GraphQL POST, but credentials/cookies remain impossible at this boundary.
   */
  fun sanitizeFetchHeaders(headers: Map<String, String>): Map<String, String> = buildMap {
    require(headers.size <= MAX_FETCH_HEADERS) { "Too many page fetch headers." }
    headers.forEach { (name, value) ->
      val normalized = name.lowercase()
      require(safeHeaderName.matches(name) && normalized in allowedFetchHeaders) {
        "Page fetch header is not allowed."
      }
      require(value.length <= MAX_FETCH_HEADER_VALUE_LENGTH && !value.contains('\r') && !value.contains('\n')) {
        "Page fetch header value is invalid."
      }
      put(normalized, value)
    }
  }

  /** Validates the only two parser-fetch methods. POST accepts bounded UTF-8 JSON only. */
  fun requireFetchRequest(method: String, body: String?, headers: Map<String, String>) {
    when (method) {
      "GET" -> require(body == null) { "GET page fetch may not include a request body." }
      "POST" -> {
        require(body != null) { "POST page fetch requires a JSON body." }
        val contentType = headers["content-type"]?.lowercase()
          ?: throw IllegalArgumentException("POST page fetch requires Content-Type application/json.")
        require((contentType == "application/json" || contentType.startsWith("application/json;")) && contentType.substringAfter(";", "").let { suffix ->
          suffix.isBlank() || suffix.split(';').all { item -> item.trim().equals("charset=utf-8", ignoreCase = true) }
        }) { "POST page fetch must use UTF-8 JSON." }
        val encoded = body.toByteArray(Charsets.UTF_8)
        require(encoded.size <= MAX_FETCH_BODY_BYTES) { "POST page fetch body is too large." }
        require(body.isNotBlank()) { "POST page fetch body is invalid." }
        try {
          val trimmed = body.trimStart()
          when {
            trimmed.startsWith("{") -> JSONObject(body)
            trimmed.startsWith("[") -> JSONArray(body)
            else -> throw IllegalArgumentException("Page fetch body must be JSON.")
          }
        } catch (error: Exception) {
          throw IllegalArgumentException("POST page fetch body must be valid JSON.", error)
        }
      }
      else -> throw IllegalArgumentException("Page fetch method is invalid.")
    }
  }

  /** Response metadata is whitelisted before returning to TypeScript parsers. */
  fun sanitizeResponseHeaders(headers: Map<String, List<String>>): Map<String, String> = buildMap {
    headers.forEach { (name, values) ->
      val normalized = name?.lowercase() ?: return@forEach
      if (normalized !in allowedResponseHeaders) return@forEach
      val value = values.firstOrNull()?.trim().orEmpty()
      if (value.isNotBlank() && value.length <= MAX_RESPONSE_HEADER_VALUE_LENGTH && !value.contains('\r') && !value.contains('\n')) {
        put(normalized, value)
      }
    }
  }

  /** Public protocol headers only; Android attaches the sole Authorization value itself. */
  fun sanitizeAiHeaders(headers: Map<String, String>): Map<String, String> = buildMap {
    require(headers.size <= 16) { "Too many AI request headers." }
    headers.forEach { (name, value) ->
      val normalized = name.lowercase()
      require(safeHeaderName.matches(name) && normalized !in forbiddenAiHeaders) {
        "AI request header is not allowed."
      }
      require(value.length <= 4_096 && !value.contains('\r') && !value.contains('\n')) {
        "AI request header value is invalid."
      }
      put(normalized, value)
    }
  }

  /**
   * The WebView may submit generic OpenAI-compatible JSON, but it may never
   * carry a credential in that document. Android attaches the sole API key
   * from Keystore after this validation succeeds.
   */
  fun requireCredentialFreeAiJson(value: String) {
    val document = try {
      JSONTokener(value).nextValue()
    } catch (error: Exception) {
      throw IllegalArgumentException("AI JSON request is invalid.", error)
    }
    require(document is JSONObject || document is JSONArray) { "AI JSON request root is invalid." }
    requireCredentialFreeAiJsonValue(document)
  }

  /** Multipart field names are public protocol metadata, never credentials. */
  fun requireCredentialFreeAiMultipartField(name: String) {
    require(safeHeaderName.matches(name) && name.lowercase() !in forbiddenAiBodyFieldNames) {
      "AI multipart field is invalid."
    }
  }

  /**
   * AI paths are relative to the Base URL saved in local preferences. Absolute URLs,
   * leading slashes, query-only paths, and traversal are rejected before a
   * Keystore credential can be attached.
   */
  fun resolveAiEndpoint(baseUrl: String, relativePath: String): URL {
    val base = requireHttpsUrl(baseUrl, "AI Base URL")
    val trimmedPath = relativePath.trim()
    require(trimmedPath.isNotEmpty()) { "AI request path is required." }
    require(!trimmedPath.startsWith('/') && !trimmedPath.startsWith('?') && !trimmedPath.startsWith('#')) {
      "AI request path must be relative."
    }
    require(!trimmedPath.contains("://") && !trimmedPath.contains('\\')) {
      "AI request path must be relative."
    }
    require(!trimmedPath.contains('?') && !trimmedPath.contains('#')) {
      "AI request path may not include a query or fragment."
    }
    require(trimmedPath.split('/').all { segment ->
      segment.isNotBlank() && segment != "." && segment != ".." && safePathSegment.matches(segment)
    }) { "AI request path contains an unsafe segment." }

    val basePath = base.path.trimEnd('/')
    return requireHttpsUrl(
      "${base.protocol}://${base.authority}$basePath/$trimmedPath",
      "AI request endpoint",
    )
  }

  private fun requireCredentialFreeAiJsonValue(value: Any) {
    when (value) {
      is JSONObject -> {
        val keys = value.keys()
        while (keys.hasNext()) {
          val name = keys.next()
          require(name.lowercase() !in forbiddenAiBodyFieldNames) { "AI request body may not include credentials." }
          if (!value.isNull(name)) requireCredentialFreeAiJsonValue(value.get(name))
        }
      }
      is JSONArray -> {
        for (index in 0 until value.length()) {
          if (!value.isNull(index)) requireCredentialFreeAiJsonValue(value.get(index))
        }
      }
    }
  }

  private fun isPrivateOrLocalAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
      address.isSiteLocalAddress || address.isMulticastAddress) {
      return true
    }
    val bytes = address.address
    if (bytes.size == 16) {
      // IPv6 unique-local fc00::/7 and the unspecified/loopback forms are
      // covered explicitly in case a platform implementation omits them.
      return (bytes[0].toInt() and 0xfe) == 0xfc || bytes.all { it == 0.toByte() } ||
        (bytes.dropLast(1).all { it == 0.toByte() } && bytes.last() == 1.toByte())
    }
    if (bytes.size != 4) return true
    val first = bytes[0].toInt() and 0xff
    val second = bytes[1].toInt() and 0xff
    return first == 0 || first == 10 || first == 127 || first >= 224 ||
      (first == 100 && second in 64..127) ||
      (first == 169 && second == 254) ||
      (first == 172 && second in 16..31) ||
      (first == 192 && second == 168) ||
      (first == 198 && second in 18..19)
  }

  private const val MAX_FETCH_HEADERS = 6
  private const val MAX_FETCH_HEADER_VALUE_LENGTH = 1_024
  private const val MAX_RESPONSE_HEADER_VALUE_LENGTH = 1_024
  const val MAX_FETCH_BODY_BYTES = 256 * 1024
}
