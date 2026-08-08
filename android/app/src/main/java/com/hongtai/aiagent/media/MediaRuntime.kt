package com.hongtai.aiagent.media

data class MediaProbe(
  val durationMs: Long?,
  val mimeType: String?,
  val hasAudio: Boolean?,
  val hasVideo: Boolean?,
)

/**
 * A decoded audio artifact kept in the application's private files directory.
 * The URI is a native-owned reference that callers can pass back to native
 * AI/media operations, but callers cannot select its directory or filename.
 */
data class PcmWavOutput(
  val uri: String,
  val sizeBytes: Long,
  val sampleRateHz: Int,
  val channelCount: Int,
)

data class PcmWavSegment(
  val uri: String,
  val sizeBytes: Long,
  val durationMs: Long,
  val sampleRateHz: Int,
  val channelCount: Int,
)

data class PcmWavSegmentationOutput(
  val sourceDurationMs: Long,
  val segments: List<PcmWavSegment>,
)

data class RemuxedVideoOutput(
  val uri: String,
  val sizeBytes: Long,
  val mimeType: String,
  val hasAudio: Boolean,
)

/**
 * The contract stays URI-based so React never moves large byte arrays through
 * the bridge. MediaCodec decoding, encoded-track remuxing, and bounded WAV
 * segmentation are implemented; full Media3 transformation remains planned.
 */
interface MediaRuntime {
  suspend fun probe(uri: String): MediaProbe
  suspend fun extractPcmWav(taskId: String, sourceUri: String): PcmWavOutput
  suspend fun segmentPcmWav(taskId: String, sourceUri: String, maxSegmentDurationMs: Int): PcmWavSegmentationOutput
  suspend fun remuxVideo(taskId: String, videoUri: String, audioUri: String? = null): RemuxedVideoOutput
}
