package com.hongtai.aiagent.network

import com.hongtai.aiagent.media.PrivateArtifactStore
import com.hongtai.aiagent.media.PrivateArtifactLengthMismatchException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * HTTPS-only downloader. It does not parse platform pages or assign task
 * stages; it merely persists an already-resolved media response into a fixed
 * app-private task path and returns after fsync plus final rename.
 */
class NativeDownloadClient(
  private val artifacts: PrivateArtifactStore,
) {
  fun download(
    request: NativeDownloadRequest,
  ): NativeDownloadResult {
    val headers = NativeNetworkPolicy.sanitizeDownloadHeaders(request.headers)
    var target = NativeNetworkPolicy.requireHttpsUrl(request.sourceUrl, "download source")
    var redirects = 0
    try {
      while (true) {
        ensureNotInterrupted()
        NativeNetworkPolicy.requirePublicNetworkTarget(target, "download source")
        val connection = (target.openConnection() as? HttpsURLConnection)
          ?: throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media source is not HTTPS.")
        try {
          connection.instanceFollowRedirects = false
          connection.requestMethod = "GET"
          connection.connectTimeout = CONNECT_TIMEOUT_MS
          connection.readTimeout = READ_TIMEOUT_MS
          connection.setRequestProperty("Accept-Encoding", "identity")
          headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
          val status = connection.responseCode
          if (status in REDIRECT_STATUS_CODES) {
            if (redirects >= MAX_REDIRECTS) {
              throw NativeNetworkException("LINK_REDIRECT_LIMIT", "The media source redirected too many times.", retryable = true)
            }
            val location = connection.getHeaderField("Location")?.trim().orEmpty()
            if (location.isBlank()) {
              throw NativeNetworkException("LINK_REDIRECT_INVALID", "The media source returned an invalid redirect.")
            }
            target = NativeNetworkPolicy.requireHttpsUrl(URL(target, location).toExternalForm(), "download redirect")
            redirects += 1
            continue
          }
          if (status !in HTTP_SUCCESS_RANGE) throw httpFailure(status)

          val totalBytes = connection.contentLengthLong.takeIf { it >= 0L }
          if (totalBytes != null && totalBytes > MAX_DOWNLOAD_BYTES) {
            throw NativeNetworkException("STORAGE_SPACE_INSUFFICIENT", "The media file is larger than the local download limit.")
          }
          val mimeType = connection.contentType?.substringBefore(';')?.trim()?.takeIf(MIME_TYPE::matches)
          requireExpectedMediaType(request.artifact, mimeType)
          val artifact = connection.inputStream.use { input ->
            artifacts.writeStream(
              taskId = request.taskId,
              relativePath = request.artifact.relativePath,
              input = input,
              maxBytes = MAX_DOWNLOAD_BYTES,
              expectedBytes = totalBytes,
              mimeType = mimeType,
              onBytesWritten = { ensureNotInterrupted() },
            )
          }
          ensureNotInterrupted()
          return NativeDownloadResult(
            taskId = request.taskId,
            uri = artifact.uri,
            mimeType = artifact.mimeType,
            sizeBytes = artifact.sizeBytes,
          )
        } finally {
          connection.disconnect()
        }
      }
    } catch (error: NativeNetworkException) {
      throw error
    } catch (error: PrivateArtifactLengthMismatchException) {
      throw NativeNetworkException(
        "MEDIA_DOWNLOAD_FAILED",
        "The media download did not match its declared size.",
        retryable = true,
        cause = error,
      )
    } catch (error: InterruptedException) {
      throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media download was cancelled.", retryable = true, cause = error)
    } catch (error: SocketTimeoutException) {
      throw NativeNetworkException("MEDIA_DOWNLOAD_TIMEOUT", "The media download timed out.", retryable = true, cause = error)
    } catch (error: IOException) {
      throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media download could not finish.", retryable = true, cause = error)
    }
  }

  private fun httpFailure(status: Int): NativeNetworkException = when (status) {
    HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_GONE ->
      NativeNetworkException("MEDIA_SOURCE_NOT_FOUND", "The media source is no longer available.")
    HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN ->
      NativeNetworkException("CONTENT_PRIVATE_OR_LOGIN_REQUIRED", "The media source requires permission or login.")
    HttpURLConnection.HTTP_CLIENT_TIMEOUT, HttpURLConnection.HTTP_GATEWAY_TIMEOUT ->
      NativeNetworkException("MEDIA_DOWNLOAD_TIMEOUT", "The media source timed out.", retryable = true)
    HttpURLConnection.HTTP_UNAVAILABLE, HttpURLConnection.HTTP_INTERNAL_ERROR, HttpURLConnection.HTTP_BAD_GATEWAY ->
      NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media source is temporarily unavailable.", retryable = true)
    else -> NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media source returned an unsupported response.", retryable = status >= 500)
  }

  private fun ensureNotInterrupted() {
    if (Thread.currentThread().isInterrupted) throw InterruptedException("Native download was interrupted.")
  }

  /** Rejects declared HTML/JSON/HLS before an app-private artifact is created. */
  private fun requireExpectedMediaType(slot: NativeDownloadArtifactSlot, mimeType: String?) {
    val normalized = mimeType?.lowercase() ?: return
    if (normalized.startsWith("text/") || normalized in BLOCKED_MIME_TYPES) {
      throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media source returned a non-media response.")
    }
    val genericBinary = normalized == "application/octet-stream"
    when (slot.kind) {
      "image" -> if (!genericBinary && !normalized.startsWith("image/")) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The image source returned an unexpected media type.")
      }
      "video", "videoPart" -> if (!genericBinary && !normalized.startsWith("video/")) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The video source returned an unexpected media type.")
      }
      "audio" -> if (!genericBinary && !normalized.startsWith("audio/")) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The audio source returned an unexpected media type.")
      }
    }
  }

  private companion object {
    const val CONNECT_TIMEOUT_MS = 15_000
    const val READ_TIMEOUT_MS = 60_000
    const val MAX_REDIRECTS = 5
    const val MAX_DOWNLOAD_BYTES = 1_073_741_824L
    val HTTP_SUCCESS_RANGE = 200..299
    val REDIRECT_STATUS_CODES = setOf(301, 302, 303, 307, 308)
    val MIME_TYPE = Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
    val BLOCKED_MIME_TYPES = setOf(
      "application/json",
      "application/problem+json",
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl",
    )
  }
}
