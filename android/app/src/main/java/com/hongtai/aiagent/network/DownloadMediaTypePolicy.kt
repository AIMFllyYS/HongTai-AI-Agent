package com.hongtai.aiagent.network

/**
 * Guards declared Content-Type before a private media artifact is created.
 *
 * Bilibili DASH audio objects are ISO BMFF and commonly advertised as
 * `video/mp4` even when the slot is audio. That declaration is accepted for
 * the audio slot; HTML, JSON and HLS playlists are still rejected.
 */
internal object DownloadMediaTypePolicy {
  fun requireExpectedMediaType(kind: String, mimeType: String?) {
    val normalized = mimeType?.lowercase() ?: return
    if (normalized.startsWith("text/") || normalized in BLOCKED_MIME_TYPES) {
      throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The media source returned a non-media response.")
    }
    val genericBinary = normalized == "application/octet-stream"
    when (kind) {
      "image" -> if (!genericBinary && !normalized.startsWith("image/")) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The image source returned an unexpected media type.")
      }
      "video", "videoPart" -> if (!genericBinary && !normalized.startsWith("video/")) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The video source returned an unexpected media type.")
      }
      "audio" -> if (!genericBinary && !normalized.startsWith("audio/") && normalized !in AUDIO_SLOT_ISO_BMFF_TYPES) {
        throw NativeNetworkException("MEDIA_DOWNLOAD_FAILED", "The audio source returned an unexpected media type.")
      }
    }
  }

  private val BLOCKED_MIME_TYPES = setOf(
    "application/json",
    "application/problem+json",
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
  )

  private val AUDIO_SLOT_ISO_BMFF_TYPES = setOf("video/mp4")
}
