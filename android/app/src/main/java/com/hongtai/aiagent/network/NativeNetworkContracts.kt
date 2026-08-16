package com.hongtai.aiagent.network

/** DTOs shared by the thin downloader and parser-fetch bridge methods. */
data class NativeDownloadRequest(
  val taskId: String,
  val sourceUrl: String,
  /** WebView chooses a semantic slot only; Android derives the private path. */
  val artifact: NativeDownloadArtifactSlot,
  /** Only NativeNetworkPolicy's fixed, credential-free header subset is accepted. */
  val headers: Map<String, String> = emptyMap(),
)

/** A fixed app-private download target; callers cannot send a path or filename. */
data class NativeDownloadArtifactSlot(
  val kind: String,
  val index: Int? = null,
) {
  init {
    require(kind in DOWNLOAD_KINDS) { "Native download artifact kind is invalid." }
    if (kind == "image") {
      require(index in 0..MAX_IMAGE_INDEX) { "Native download artifact index is invalid." }
    } else {
      require(index == null) { "Native media artifact does not accept an index." }
    }
  }

  val relativePath: String
    get() = when (kind) {
      "image" -> "media/images/image-$index.bin"
      "video" -> "media/video.mp4"
      "videoPart" -> "media/video-source.bin"
      "audio" -> "media/audio-source.bin"
      else -> throw IllegalStateException("Native download artifact kind is invalid.")
    }

  private companion object {
    const val MAX_IMAGE_INDEX = 99
    val DOWNLOAD_KINDS = setOf("image", "video", "videoPart", "audio")
  }
}

data class NativeTextFetchRequest(
  val method: String,
  val url: String,
  val headers: Map<String, String> = emptyMap(),
  /** Bounded UTF-8 JSON POST body only; never persisted by native. */
  val body: String? = null,
  /** Zero means: resolve one Location and return that URL without reading a body or fetching the target. */
  val maxRedirects: Int? = null,
  /** Applies to both connection and read waits for this one parser request. */
  val timeoutMs: Int? = null,
  /** Short retry count requested by an existing platform adapter. */
  val maxAttempts: Int? = null,
)

data class NativeTextFetchResult(
  val finalUrl: String,
  val status: Int,
  val headers: Map<String, String>,
  /** Parser-only response text. Callers must not persist or render it directly. */
  val body: String,
)

data class NativeDownloadResult(
  val taskId: String,
  val uri: String,
  val mimeType: String?,
  val sizeBytes: Long,
)

data class NativeDownloadProgress(
  val downloadedBytes: Long,
  val totalBytes: Long?,
  val progress: Double?,
)

class NativeNetworkException(
  val code: String,
  val userMessage: String,
  val retryable: Boolean = false,
  val diagnostic: NativeLinkDiagnostic? = null,
  cause: Throwable? = null,
) : IllegalStateException(userMessage, cause)
