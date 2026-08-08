package com.hongtai.aiagent.media

/**
 * Pure task-media boundary shared by MediaCodec operations. A canonical file
 * path is converted to a relative path before reaching this policy, so the
 * policy deliberately rejects path traversal and does not repair it.
 */
internal object TaskPrivateMediaPolicy {
  private val taskIdPattern = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
  private val unsafeSegment = Regex("[\\\\\u0000-\u001F\u007F]")

  fun taskIdForRelativeInputPath(value: String): String? {
    val normalized = value.replace('\\', '/')
    if (normalized.isBlank() || normalized.startsWith('/')) return null
    val segments = normalized.split('/')
    if (segments.size < 4 || segments[0] != "tasks" || segments[2] != "media") return null
    if (!taskIdPattern.matches(segments[1])) return null
    if (segments.drop(3).any(::isUnsafeSegment)) return null
    return segments[1]
  }

  fun isTaskSegmentablePcmInputPath(taskId: String, value: String): Boolean {
    val normalized = value.replace('\\', '/')
    if (taskIdForRelativeInputPath(normalized) != taskId) return false
    return normalized == "tasks/$taskId/media/audio.wav" ||
      (
        normalized.startsWith("tasks/$taskId/media/pcm/") &&
          normalized.removePrefix("tasks/$taskId/media/pcm/").isNotBlank()
      )
  }

  private fun isUnsafeSegment(segment: String): Boolean =
    segment.isBlank() || segment == "." || segment == ".." || segment.endsWith(".part") || unsafeSegment.containsMatchIn(segment)
}

/** MP4 track combinations that this native remuxer can preserve without transcoding. */
internal object TaskMediaRemuxPolicy {
  private val videoMimes = setOf("video/avc", "video/hevc")
  private val audioMimes = setOf("audio/mp4a-latm")

  fun isSupportedVideoMime(mimeType: String?): Boolean = mimeType in videoMimes
  fun isSupportedAudioMime(mimeType: String?): Boolean = mimeType in audioMimes
}

internal data class PcmWavSegmentPlan(
  val byteOffset: Long,
  val dataBytes: Long,
  val durationMs: Long,
)

/** Bounds ASR inputs before any output file is opened. */
internal object PcmWavSegmentationPolicy {
  const val MIN_SEGMENT_DURATION_MS = 10_000
  const val MAX_SEGMENT_DURATION_MS = 120_000
  const val MAX_SEGMENTS = 100
  /** 14 MiB total WAV budget leaves headroom below the native AI 15 MiB attachment limit. */
  const val MAX_SEGMENT_TOTAL_BYTES = 14L * 1_024L * 1_024L
  const val MAX_SEGMENT_DATA_BYTES = MAX_SEGMENT_TOTAL_BYTES - PcmWavEncoding.HEADER_BYTES

  fun requireSegmentDurationMs(value: Int): Long {
    require(value in MIN_SEGMENT_DURATION_MS..MAX_SEGMENT_DURATION_MS) {
      "The ASR segment duration is outside the supported range."
    }
    return value.toLong()
  }

  fun plan(
    sampleRateHz: Int,
    channelCount: Int,
    dataBytes: Long,
    maxSegmentDurationMs: Int,
  ): List<PcmWavSegmentPlan> {
    val maximumDurationMs = requireSegmentDurationMs(maxSegmentDurationMs)
    require(sampleRateHz in 8_000..192_000) { "The PCM sample rate is unsupported." }
    require(channelCount in 1..8) { "The PCM channel count is unsupported." }
    val bytesPerFrame = channelCount.toLong() * PCM_BYTES_PER_SAMPLE
    require(dataBytes in bytesPerFrame..PcmWavEncoding.MAX_DATA_BYTES && dataBytes % bytesPerFrame == 0L) {
      "The PCM data is invalid."
    }
    val durationBoundFrames = (sampleRateHz.toLong() * maximumDurationMs) / 1_000L
    val byteBoundFrames = MAX_SEGMENT_DATA_BYTES / bytesPerFrame
    val framesPerSegment = minOf(durationBoundFrames, byteBoundFrames)
    require(framesPerSegment > 0L) { "The ASR segment duration is invalid." }

    val totalFrames = dataBytes / bytesPerFrame
    val segmentCount = ((totalFrames + framesPerSegment - 1L) / framesPerSegment).toInt()
    require(segmentCount in 1..MAX_SEGMENTS) { "The PCM audio requires too many ASR segments." }

    return buildList(segmentCount) {
      var frameOffset = 0L
      while (frameOffset < totalFrames) {
        val frameCount = minOf(framesPerSegment, totalFrames - frameOffset)
        val durationMs = (frameCount * 1_000L) / sampleRateHz
        add(
          PcmWavSegmentPlan(
            byteOffset = frameOffset * bytesPerFrame,
            dataBytes = frameCount * bytesPerFrame,
            durationMs = durationMs,
          ),
        )
        frameOffset += frameCount
      }
    }
  }

  private const val PCM_BYTES_PER_SAMPLE = 2L
}
