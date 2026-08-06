package com.hongtai.aiagent.media

data class MediaProbe(
  val durationMs: Long?,
  val mimeType: String?,
  val hasAudio: Boolean?,
  val hasVideo: Boolean?,
)

/**
 * Phase 5 implements this with Media3 Transformer and MediaCodec. The contract
 * stays URI-based so React never moves large byte arrays through the bridge.
 */
interface MediaRuntime {
  suspend fun probe(uri: String): MediaProbe
  suspend fun extractPcmWav(sourceUri: String, destinationRelativePath: String): String
}

class MediaRuntimeNotReadyException : IllegalStateException(
  "Media3 and MediaCodec operations are not connected yet.",
)
