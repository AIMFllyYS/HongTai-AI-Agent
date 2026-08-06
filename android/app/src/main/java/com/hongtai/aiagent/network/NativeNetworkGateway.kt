package com.hongtai.aiagent.network

/**
 * DTO-only contract for the phase-5 native downloader and SSE transport. API
 * keys are never an option here: the implementation reads the active key from
 * AndroidKeystoreSecretStore inside the native request path.
 */
data class NativeDownloadRequest(
  val taskId: String,
  val sourceUrl: String,
  val destinationRelativePath: String,
)

data class NativeSseRequest(
  val requestId: String,
  val connectionId: String,
  val relativePath: String,
  val method: String,
  val bodyUri: String?,
)

interface NativeNetworkGateway {
  suspend fun download(request: NativeDownloadRequest)
  suspend fun openSse(request: NativeSseRequest)
}

class NativeNetworkNotReadyException : IllegalStateException(
  "Native download and SSE execution are not connected yet.",
)
