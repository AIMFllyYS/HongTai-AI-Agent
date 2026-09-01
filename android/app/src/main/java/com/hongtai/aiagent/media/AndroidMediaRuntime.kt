package com.hongtai.aiagent.media

import android.content.Context
import android.graphics.Bitmap
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.roundToInt

class MediaProbeException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
class MediaDecodeException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
class MediaRemuxException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
class PcmWavSegmentationException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
class MediaFrameCaptureException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
private class MediaOperationTimeoutException(message: String) : IllegalStateException(message)

/**
 * Real, read-only metadata probe for an existing app-private media file. It
 * does not transcode, merge, decode PCM, or claim a Media3 transformation has
 * completed.
 */
class AndroidMediaRuntime(context: Context) : MediaRuntime {
  private val appContext = context.applicationContext
  private val artifacts = PrivateArtifactStore(context)

  override suspend fun probe(uri: String): MediaProbe = probeNow(uri)

  fun probeNow(uri: String): MediaProbe {
    val file = requirePrivateMediaInput(uri)
    try {
      val extractor = MediaExtractor()
      var hasAudio = false
      var hasVideo = false
      var firstMimeType: String? = null
      try {
        extractor.setDataSource(file.absolutePath)
        for (index in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(index)
          val mime = format.getString(MediaFormat.KEY_MIME)
          if (firstMimeType == null) firstMimeType = mime
          if (mime?.startsWith("audio/") == true) hasAudio = true
          if (mime?.startsWith("video/") == true) hasVideo = true
        }
      } finally {
        extractor.release()
      }

      val retriever = MediaMetadataRetriever()
      val durationMs: Long?
      val metadataMimeType: String?
      try {
        retriever.setDataSource(file.absolutePath)
        durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        metadataMimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
      } finally {
        retriever.release()
      }
      return MediaProbe(
        durationMs = durationMs,
        mimeType = metadataMimeType ?: firstMimeType,
        hasAudio = hasAudio,
        hasVideo = hasVideo,
      )
    } catch (error: MediaProbeException) {
      throw error
    } catch (error: Exception) {
      throw MediaProbeException("The private media file could not be probed.", error)
    }
  }

  /**
   * Captures the task video's first frame into the fixed, regenerable
   * `media/thumbnail.jpg` slot. The WebView names only the task; the path, the
   * 720px bound and the JPEG quality are decided here. Failing loudly is
   * deliberate: a caller must not treat a missing frame as a written thumbnail.
   */
  fun captureFrameNow(taskId: String): PrivateArtifactFile {
    val normalizedTaskId = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val mediaDirectory = taskMediaDirectory(normalizedTaskId)
    val video = File(mediaDirectory, TASK_VIDEO_FILE_NAME)
    if (!video.isFile) throw MediaFrameCaptureException("The task video is unavailable.")
    // The fixed path still passes the full task-media input policy, so this
    // method can never read outside the requesting task's private media tree.
    val source = requireTaskOwnedMediaInput(normalizedTaskId, Uri.fromFile(video).toString())
    val destination = File(mediaDirectory, TASK_THUMBNAIL_FILE_NAME)
    val retriever = MediaMetadataRetriever()
    var frame: Bitmap? = null
    var scaled: Bitmap? = null
    try {
      retriever.setDataSource(source.absolutePath)
      frame = decodeFirstFrame(retriever)
        ?: throw MediaFrameCaptureException("The task video has no decodable first frame.")
      scaled = scaleToFit(frame, THUMBNAIL_MAX_EDGE_PIXELS)
      if (!FrameJpegWriter.writeAtomically(scaled, destination, THUMBNAIL_JPEG_QUALITY, MAX_THUMBNAIL_BYTES)) {
        throw MediaFrameCaptureException("The task video frame could not be written.")
      }
      if (!FrameJpegWriter.isJpeg(destination)) {
        deleteQuietly(destination)
        throw MediaFrameCaptureException("The task video frame could not be verified.")
      }
      return PrivateArtifactFile(Uri.fromFile(destination).toString(), destination.length(), THUMBNAIL_MIME_TYPE)
    } catch (error: MediaFrameCaptureException) {
      throw error
    } catch (error: Exception) {
      throw MediaFrameCaptureException("The task video frame could not be captured.", error)
    } finally {
      runCatching { retriever.release() }
      listOf(scaled, frame).distinct().forEach { bitmap ->
        if (bitmap != null && !bitmap.isRecycled) bitmap.recycle()
      }
    }
  }

  /** `getScaledFrameAtTime` decodes into the target size and only exists from API 27. */
  private fun decodeFirstFrame(retriever: MediaMetadataRetriever): Bitmap? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      retriever.getScaledFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, THUMBNAIL_MAX_EDGE_PIXELS, THUMBNAIL_MAX_EDGE_PIXELS)
    } else {
      retriever.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
    }

  private fun scaleToFit(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val edge = maxOf(bitmap.width, bitmap.height)
    if (edge <= maxEdge) return bitmap
    val scale = maxEdge.toFloat() / edge.toFloat()
    return Bitmap.createScaledBitmap(
      bitmap,
      (bitmap.width * scale).toInt().coerceAtLeast(1),
      (bitmap.height * scale).toInt().coerceAtLeast(1),
      true,
    )
  }

  /** The task's canonical `media` directory; the taskId policy already excludes traversal. */
  private fun taskMediaDirectory(taskId: String): File {
    val taskDirectoryName = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val root = appContext.filesDir.canonicalFile
    val expected = File(root, "tasks/$taskDirectoryName/media").canonicalFile
    require(expected.path.startsWith("${root.path}${File.separator}")) {
      "Private task media storage is outside the application files directory."
    }
    return expected
  }

  override suspend fun extractPcmWav(taskId: String, sourceUri: String): PcmWavOutput = extractPcmWavNow(taskId, sourceUri)

  /**
   * Decodes the first audio track of a private media artifact with
   * MediaExtractor/MediaCodec and writes canonical little-endian 16-bit PCM
   * into an atomically finalized WAV file. The output path is generated by the
   * native runtime; no WebView-provided filename or directory is accepted.
   */
  fun extractPcmWavNow(taskId: String, sourceUri: String): PcmWavOutput {
    val source = requireTaskOwnedMediaInput(taskId, sourceUri)
    return try {
      if (source.length() !in 1..MAX_SOURCE_BYTES) {
        throw MediaDecodeException("The private media file is outside the supported decode size.")
      }
      decodeToWav(taskId, source)
    } catch (error: MediaDecodeException) {
      throw error
    } catch (error: InterruptedException) {
      Thread.currentThread().interrupt()
      throw MediaDecodeException("The private media decode was cancelled.", error)
    } catch (error: Exception) {
      throw MediaDecodeException("The private media audio could not be decoded.", error)
    }
  }

  override suspend fun segmentPcmWav(
    taskId: String,
    sourceUri: String,
    maxSegmentDurationMs: Int,
  ): PcmWavSegmentationOutput = segmentPcmWavNow(taskId, sourceUri, maxSegmentDurationMs)

  /**
   * Splits only canonical PCM/WAV output created for this task. The caller
   * chooses a bounded duration but never an output directory, filename, or
   * arbitrary input outside the same task's private media tree.
   */
  fun segmentPcmWavNow(
    taskId: String,
    sourceUri: String,
    maxSegmentDurationMs: Int,
  ): PcmWavSegmentationOutput {
    val source = requireTaskOwnedMediaInput(taskId, sourceUri)
    val normalizedTaskId = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val sourceRelativePath = privateRelativePath(source)
    require(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath(normalizedTaskId, sourceRelativePath)) {
      "Only task-owned PCM/WAV artifacts can be segmented for ASR."
    }
    val finalizedOutputs = mutableListOf<File>()
    try {
      if (source.length() !in (PcmWavEncoding.HEADER_BYTES + 1L)..MAX_PCM_SOURCE_BYTES) {
        throw PcmWavSegmentationException("The private PCM/WAV file is outside the supported size.")
      }
      val header = CanonicalPcmWavHeader.read(source)
      val plan = PcmWavSegmentationPolicy.plan(
        sampleRateHz = header.sampleRateHz,
        channelCount = header.channelCount,
        dataBytes = header.dataBytes,
        maxSegmentDurationMs = maxSegmentDurationMs,
      )
      val format = PcmWavFormat(
        sampleRateHz = header.sampleRateHz,
        channelCount = header.channelCount,
        sourceEncoding = AudioFormat.ENCODING_PCM_16BIT,
      )
      val deadlineElapsedMs = SystemClock.elapsedRealtime() + MAX_SEGMENT_WALL_CLOCK_MS
      val segments = RandomAccessFile(source, "r").use { input ->
        plan.map { segment ->
          ensureOperationWithinDeadline(deadlineElapsedMs, "The PCM/WAV segmentation exceeded its time limit.")
          val destination = createTaskOutputFile(normalizedTaskId, ASR_DIRECTORY_NAME)
          finalizedOutputs += destination
          val writer = AtomicPcmWavWriter(destination, format)
          try {
            input.seek(PcmWavEncoding.HEADER_BYTES.toLong() + segment.byteOffset)
            var remaining = segment.dataBytes
            val buffer = ByteArray(SEGMENT_COPY_BUFFER_BYTES)
            while (remaining > 0L) {
              ensureOperationWithinDeadline(deadlineElapsedMs, "The PCM/WAV segmentation exceeded its time limit.")
              val count = minOf(buffer.size.toLong(), remaining).toInt()
              input.readFully(buffer, 0, count)
              writer.write(if (count == buffer.size) buffer else buffer.copyOf(count), format)
              remaining -= count.toLong()
            }
            val output = writer.finish()
            PcmWavSegment(
              uri = output.uri,
              sizeBytes = output.sizeBytes,
              durationMs = segment.durationMs,
              sampleRateHz = output.sampleRateHz,
              channelCount = output.channelCount,
            )
          } catch (error: Exception) {
            writer.abort()
            throw error
          }
        }
      }
      return PcmWavSegmentationOutput(
        sourceDurationMs = header.durationMs,
        segments = segments,
      )
    } catch (error: PcmWavSegmentationException) {
      finalizedOutputs.forEach(::deleteQuietly)
      throw error
    } catch (error: MediaOperationTimeoutException) {
      finalizedOutputs.forEach(::deleteQuietly)
      throw PcmWavSegmentationException("The PCM/WAV segmentation exceeded its time limit.", error)
    } catch (error: InterruptedException) {
      finalizedOutputs.forEach(::deleteQuietly)
      Thread.currentThread().interrupt()
      throw PcmWavSegmentationException("The PCM/WAV segmentation was cancelled.", error)
    } catch (error: Exception) {
      finalizedOutputs.forEach(::deleteQuietly)
      throw PcmWavSegmentationException("The private PCM/WAV file could not be segmented safely.", error)
    }
  }

  override suspend fun remuxVideo(
    taskId: String,
    videoUri: String,
    audioUri: String?,
  ): RemuxedVideoOutput = remuxVideoNow(taskId, videoUri, audioUri)

  /**
   * Encoded-track-only MP4 remux: no transcoding and no timestamp rewriting.
   * If a source combination cannot be verified with its original sample
   * timestamps, the temporary output is discarded instead of being exposed.
   */
  fun remuxVideoNow(taskId: String, videoUri: String, audioUri: String? = null): RemuxedVideoOutput {
    val normalizedTaskId = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val video = requireTaskOwnedMediaInput(normalizedTaskId, videoUri)
    val audio = audioUri?.let { requireTaskOwnedMediaInput(normalizedTaskId, it) }
    require(audio == null || audio.canonicalFile != video.canonicalFile) {
      "A separate audio URI must not be the same file as the video URI."
    }
    try {
      if (video.length() !in 1..MAX_REMUX_SOURCE_BYTES || (audio != null && audio.length() !in 1..MAX_REMUX_SOURCE_BYTES)) {
        throw MediaRemuxException("The private media file is outside the supported remux size.")
      }
      val videoTracks = inspectVideoSource(video, includeEmbeddedAudio = audio == null)
      val audioTrack = if (audio == null) videoTracks.audio else inspectAudioSource(audio)
      return remuxTracks(normalizedTaskId, videoTracks.video, audioTrack)
    } catch (error: MediaRemuxException) {
      throw error
    } catch (error: MediaOperationTimeoutException) {
      throw MediaRemuxException("The private media remux exceeded its time limit.", error)
    } catch (error: InterruptedException) {
      Thread.currentThread().interrupt()
      throw MediaRemuxException("The private media remux was cancelled.", error)
    } catch (error: Exception) {
      throw MediaRemuxException("The private media files could not be remuxed safely.", error)
    }
  }

  private fun inspectVideoSource(source: File, includeEmbeddedAudio: Boolean): VideoSourceTracks {
    val tracks = inspectTracks(source)
    require(tracks.all { it.mimeType.startsWith("video/") || it.mimeType.startsWith("audio/") }) {
      "The video source contains tracks that cannot be preserved by the local remuxer."
    }
    val videoTracks = tracks.filter { it.mimeType.startsWith("video/") }
    val audioTracks = tracks.filter { it.mimeType.startsWith("audio/") }
    require(videoTracks.size == 1) { "The video source must contain exactly one video track." }
    require(TaskMediaRemuxPolicy.isSupportedVideoMime(videoTracks.single().mimeType)) {
      "The downloaded video codec cannot be remuxed safely."
    }
    if (includeEmbeddedAudio) {
      require(audioTracks.size <= 1) { "The video source has multiple audio tracks that cannot be remuxed safely." }
      audioTracks.singleOrNull()?.let { track ->
        require(TaskMediaRemuxPolicy.isSupportedAudioMime(track.mimeType)) {
          "The downloaded audio codec cannot be remuxed safely."
        }
      }
    }
    return VideoSourceTracks(videoTracks.single(), if (includeEmbeddedAudio) audioTracks.singleOrNull() else null)
  }

  private fun inspectAudioSource(source: File): MediaTrackSource {
    val tracks = inspectTracks(source)
    require(tracks.all { it.mimeType.startsWith("audio/") }) {
      "The separate audio source contains tracks that cannot be preserved by the local remuxer."
    }
    val videoTracks = tracks.filter { it.mimeType.startsWith("video/") }
    val audioTracks = tracks.filter { it.mimeType.startsWith("audio/") }
    require(videoTracks.isEmpty() && audioTracks.size == 1) {
      "The separate audio source must contain exactly one audio track and no video track."
    }
    return audioTracks.single().also { track ->
      require(TaskMediaRemuxPolicy.isSupportedAudioMime(track.mimeType)) {
        "The downloaded audio codec cannot be remuxed safely."
      }
    }
  }

  private fun inspectTracks(source: File): List<MediaTrackSource> {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(source.absolutePath)
      return (0 until extractor.trackCount).map { index ->
        val mimeType = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)
          ?: throw MediaRemuxException("A downloaded media track has no MIME type.")
        MediaTrackSource(source, index, mimeType)
      }
    } finally {
      extractor.release()
    }
  }

  private fun remuxTracks(
    taskId: String,
    video: MediaTrackSource,
    audio: MediaTrackSource?,
  ): RemuxedVideoOutput {
    val destination = createTaskOutputFile(taskId, REMUX_DIRECTORY_NAME, "mp4")
    val temporary = File(destination.parentFile, ".${destination.name}.${UUID.randomUUID()}.part")
    var muxer: MediaMuxer? = null
    val sessions = mutableListOf<RemuxTrackSession>()
    var muxerStarted = false
    var finalized = false
    try {
      val deadlineElapsedMs = SystemClock.elapsedRealtime() + MAX_REMUX_WALL_CLOCK_MS
      muxer = MediaMuxer(temporary.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val videoSession = openRemuxTrack(video, muxer)
      sessions += videoSession
      val audioSession = audio?.let { source -> openRemuxTrack(source, muxer).also(sessions::add) }
      muxer.start()
      muxerStarted = true

      val videoSummary = copyEncodedTrack(videoSession, muxer, deadlineElapsedMs)
      val audioSummary = audioSession?.let { copyEncodedTrack(it, muxer, deadlineElapsedMs) }
      if (audioSummary != null) requireTrackTimingCompatibility(videoSummary, audioSummary)

      muxer.stop()
      muxerStarted = false
      muxer.release()
      muxer = null
      sessions.forEach(RemuxTrackSession::release)
      sessions.clear()

      syncFile(temporary)
      require(temporary.length() in 1..MAX_REMUX_OUTPUT_BYTES) {
        "The remuxed media output is outside the supported size."
      }
      verifyRemuxOutput(temporary, videoSummary, audioSummary, deadlineElapsedMs)
      syncFile(temporary)
      if (!temporary.renameTo(destination)) {
        throw MediaRemuxException("Could not finalize the private remuxed media file.")
      }
      finalized = true
      return RemuxedVideoOutput(
        uri = Uri.fromFile(destination).toString(),
        sizeBytes = destination.length(),
        mimeType = REMUX_MIME_TYPE,
        hasAudio = audioSummary != null,
      )
    } finally {
      if (muxerStarted) runCatching { muxer?.stop() }
      runCatching { muxer?.release() }
      sessions.forEach(RemuxTrackSession::release)
      if (!finalized) deleteQuietly(temporary)
    }
  }

  private fun openRemuxTrack(source: MediaTrackSource, muxer: MediaMuxer): RemuxTrackSession {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(source.file.absolutePath)
      val format = extractor.getTrackFormat(source.trackIndex)
      val actualMimeType = format.getString(MediaFormat.KEY_MIME)
      require(actualMimeType == source.mimeType) { "The downloaded media track changed while it was being remuxed." }
      val declaredInputSize = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
        format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
      } else {
        DEFAULT_ENCODED_SAMPLE_BYTES
      }
      require(declaredInputSize in 1..MAX_ENCODED_SAMPLE_BYTES) {
        "A downloaded media sample is outside the supported remux size."
      }
      extractor.selectTrack(source.trackIndex)
      return RemuxTrackSession(
        source = source,
        extractor = extractor,
        muxerTrackIndex = muxer.addTrack(format),
        buffer = ByteBuffer.allocate(maxOf(declaredInputSize, DEFAULT_ENCODED_SAMPLE_BYTES)),
      )
    } catch (error: Exception) {
      extractor.release()
      throw error
    }
  }

  private fun copyEncodedTrack(
    session: RemuxTrackSession,
    muxer: MediaMuxer,
    deadlineElapsedMs: Long,
  ): TrackSampleSummary {
    var sampleCount = 0L
    var firstPresentationTimeUs: Long? = null
    var lastPresentationTimeUs = -1L
    val timestampDigest = TrackTimestampDigest()
    while (true) {
      ensureOperationWithinDeadline(deadlineElapsedMs, "The private media remux exceeded its time limit.")
      val buffer = session.buffer
      buffer.clear()
      val sampleSize = session.extractor.readSampleData(buffer, 0)
      if (sampleSize < 0) break
      require(sampleSize in 1..buffer.capacity()) { "A downloaded media sample is outside the supported remux size." }
      val presentationTimeUs = session.extractor.sampleTime
      require(presentationTimeUs >= 0L && presentationTimeUs >= lastPresentationTimeUs && presentationTimeUs <= MAX_TRACK_TIMESTAMP_US) {
        "The downloaded media timestamps cannot be preserved safely."
      }
      val sourceFlags = session.extractor.sampleFlags
      require(sourceFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED == 0) {
        "Encrypted downloaded media cannot be remuxed locally."
      }
      val flags = normalizedSampleFlags(sourceFlags)
      muxer.writeSampleData(
        session.muxerTrackIndex,
        buffer,
        MediaCodec.BufferInfo().apply { set(0, sampleSize, presentationTimeUs, flags) },
      )
      if (sampleCount == 0L) firstPresentationTimeUs = presentationTimeUs
      lastPresentationTimeUs = presentationTimeUs
      timestampDigest.add(presentationTimeUs, sampleSize, flags)
      sampleCount += 1L
      require(sampleCount <= MAX_SAMPLES_PER_TRACK) { "The downloaded media has too many remux samples." }
      session.extractor.advance()
    }
    return TrackSampleSummary(
      mimeType = session.source.mimeType,
      sampleCount = sampleCount,
      firstPresentationTimeUs = firstPresentationTimeUs ?: throw MediaRemuxException("A downloaded media track has no samples."),
      lastPresentationTimeUs = lastPresentationTimeUs,
      timestampDigest = timestampDigest.value(),
    )
  }

  private fun requireTrackTimingCompatibility(video: TrackSampleSummary, audio: TrackSampleSummary) {
    require(kotlin.math.abs(video.firstPresentationTimeUs - audio.firstPresentationTimeUs) <= MAX_AV_START_OFFSET_US) {
      "The downloaded video and audio timestamps cannot be aligned safely."
    }
    require(kotlin.math.abs(video.lastPresentationTimeUs - audio.lastPresentationTimeUs) <= MAX_AV_END_OFFSET_US) {
      "The downloaded video and audio durations cannot be aligned safely."
    }
  }

  private fun verifyRemuxOutput(
    output: File,
    expectedVideo: TrackSampleSummary,
    expectedAudio: TrackSampleSummary?,
    deadlineElapsedMs: Long,
  ) {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(output.absolutePath)
      val outputTracks = (0 until extractor.trackCount).map { index ->
        index to (extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)
          ?: throw MediaRemuxException("The remuxed media output has a track without a MIME type."))
      }
      val videoTrackIndex = outputTracks.singleOrNull { (_, mimeType) -> mimeType == expectedVideo.mimeType }?.first
        ?: throw MediaRemuxException("The remuxed video track could not be verified.")
      require(summarizeEncodedTrack(extractor, videoTrackIndex, deadlineElapsedMs) == expectedVideo) {
        "The remuxed video timestamps could not be verified."
      }
      if (expectedAudio == null) {
        require(outputTracks.none { (_, mimeType) -> mimeType.startsWith("audio/") }) {
          "The remuxed output contains an unexpected audio track."
        }
      } else {
        val audioTrackIndex = outputTracks.singleOrNull { (_, mimeType) -> mimeType == expectedAudio.mimeType }?.first
          ?: throw MediaRemuxException("The remuxed audio track could not be verified.")
        require(summarizeEncodedTrack(extractor, audioTrackIndex, deadlineElapsedMs) == expectedAudio) {
          "The remuxed audio timestamps could not be verified."
        }
      }
    } finally {
      extractor.release()
    }
  }

  private fun summarizeEncodedTrack(
    extractor: MediaExtractor,
    trackIndex: Int,
    deadlineElapsedMs: Long,
  ): TrackSampleSummary {
    val format = extractor.getTrackFormat(trackIndex)
    val mimeType = format.getString(MediaFormat.KEY_MIME)
      ?: throw MediaRemuxException("The remuxed media output has a track without a MIME type.")
    val declaredInputSize = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
      format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
    } else {
      DEFAULT_ENCODED_SAMPLE_BYTES
    }
    require(declaredInputSize in 1..MAX_ENCODED_SAMPLE_BYTES) {
      "The remuxed media output has an unsupported sample size."
    }
    val buffer = ByteBuffer.allocate(maxOf(declaredInputSize, DEFAULT_ENCODED_SAMPLE_BYTES))
    extractor.selectTrack(trackIndex)
    try {
      var sampleCount = 0L
      var firstPresentationTimeUs: Long? = null
      var lastPresentationTimeUs = -1L
      val timestampDigest = TrackTimestampDigest()
      while (true) {
        ensureOperationWithinDeadline(deadlineElapsedMs, "The remuxed media verification exceeded its time limit.")
        buffer.clear()
        val sampleSize = extractor.readSampleData(buffer, 0)
        if (sampleSize < 0) break
        require(sampleSize in 1..buffer.capacity()) { "The remuxed media output has an unsupported sample size." }
        val presentationTimeUs = extractor.sampleTime
        require(presentationTimeUs >= 0L && presentationTimeUs >= lastPresentationTimeUs && presentationTimeUs <= MAX_TRACK_TIMESTAMP_US) {
          "The remuxed media output has invalid timestamps."
        }
        if (sampleCount == 0L) firstPresentationTimeUs = presentationTimeUs
        lastPresentationTimeUs = presentationTimeUs
        timestampDigest.add(presentationTimeUs, sampleSize, normalizedSampleFlags(extractor.sampleFlags))
        sampleCount += 1L
        require(sampleCount <= MAX_SAMPLES_PER_TRACK) { "The remuxed media output has too many samples." }
        extractor.advance()
      }
      return TrackSampleSummary(
        mimeType = mimeType,
        sampleCount = sampleCount,
        firstPresentationTimeUs = firstPresentationTimeUs ?: throw MediaRemuxException("The remuxed media output has no samples."),
        lastPresentationTimeUs = lastPresentationTimeUs,
        timestampDigest = timestampDigest.value(),
      )
    } finally {
      extractor.unselectTrack(trackIndex)
    }
  }

  private fun decodeToWav(taskId: String, source: File): PcmWavOutput {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var decoderStarted = false
    var writer: AtomicPcmWavWriter? = null
    var finalized = false
    try {
      extractor.setDataSource(source.absolutePath)
      val audioTrackIndex = (0 until extractor.trackCount).firstOrNull { index ->
        extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw MediaDecodeException("The private media file does not contain an audio track.")
      val inputFormat = extractor.getTrackFormat(audioTrackIndex)
      val mimeType = inputFormat.getString(MediaFormat.KEY_MIME)
        ?: throw MediaDecodeException("The private audio track has no MIME type.")

      extractor.selectTrack(audioTrackIndex)
      val activeDecoder = MediaCodec.createDecoderByType(mimeType)
      decoder = activeDecoder
      activeDecoder.configure(inputFormat, null, null, 0)
      activeDecoder.start()
      decoderStarted = true

      val bufferInfo = MediaCodec.BufferInfo()
      var inputFinished = false
      var outputFinished = false
      var activeFormat: PcmWavFormat? = null
      val deadlineElapsedMs = SystemClock.elapsedRealtime() + MAX_DECODE_WALL_CLOCK_MS

      while (!outputFinished) {
        ensureNotInterrupted()
        if (SystemClock.elapsedRealtime() > deadlineElapsedMs) {
          throw MediaDecodeException("The private media decode exceeded its time limit.")
        }
        if (!inputFinished) {
          val inputIndex = activeDecoder.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
          if (inputIndex >= 0) {
            val inputBuffer = activeDecoder.getInputBuffer(inputIndex)
              ?: throw MediaDecodeException("The media decoder did not provide an input buffer.")
            inputBuffer.clear()
            val sampleSize = extractor.readSampleData(inputBuffer, 0)
            if (sampleSize < 0) {
              activeDecoder.queueInputBuffer(
                inputIndex,
                0,
                0,
                0L,
                MediaCodec.BUFFER_FLAG_END_OF_STREAM,
              )
              inputFinished = true
            } else {
              if (sampleSize > inputBuffer.capacity()) {
                throw MediaDecodeException("An encoded audio sample is larger than the decoder input buffer.")
              }
              activeDecoder.queueInputBuffer(inputIndex, 0, sampleSize, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        when (val outputIndex = activeDecoder.dequeueOutputBuffer(bufferInfo, DEQUEUE_TIMEOUT_US)) {
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val format = PcmWavFormat.from(activeDecoder.outputFormat)
            if (activeFormat != null && activeFormat != format && (writer?.dataBytes ?: 0L) > 0L) {
              throw MediaDecodeException("The audio decoder changed PCM format after writing output.")
            }
            activeFormat = format
          }
          else -> if (outputIndex >= 0) {
            try {
              if (bufferInfo.size > 0 && bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                val format = activeFormat ?: PcmWavFormat.from(activeDecoder.outputFormat).also { activeFormat = it }
                val outputBuffer = activeDecoder.getOutputBuffer(outputIndex)
                  ?: throw MediaDecodeException("The media decoder did not provide an output buffer.")
                val bytes = outputBuffer.copyRange(bufferInfo.offset, bufferInfo.size)
                if (writer == null) writer = AtomicPcmWavWriter(createTaskOutputFile(taskId, PCM_DIRECTORY_NAME), format)
                writer!!.write(bytes, format)
              }
              if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                outputFinished = true
              }
            } finally {
              activeDecoder.releaseOutputBuffer(outputIndex, false)
            }
          }
        }
      }

      val result = writer?.finish()
        ?: throw MediaDecodeException("The media decoder produced no PCM audio output.")
      finalized = true
      return result
    } finally {
      if (!finalized) writer?.abort()
      if (decoderStarted) runCatching { decoder?.stop() }
      runCatching { decoder?.release() }
      extractor.release()
    }
  }

  private fun createTaskOutputFile(taskId: String, mediaSubdirectory: String, extension: String = "wav"): File {
    val taskDirectoryName = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val directory = File(appContext.filesDir, "tasks/$taskDirectoryName/media/$mediaSubdirectory")
    if (!directory.exists() && !directory.mkdirs()) {
      throw MediaDecodeException("Could not create private task media storage.")
    }
    val canonicalDirectory = directory.canonicalFile
    val root = appContext.filesDir.canonicalFile
    val requiredPrefix = "${File(root, "tasks/$taskDirectoryName/media").canonicalPath}${File.separator}"
    require(canonicalDirectory.path.startsWith(requiredPrefix) && canonicalDirectory.path.startsWith("${root.path}${File.separator}")) {
      "Private task media storage is outside the application files directory."
    }
    return File(canonicalDirectory, "${UUID.randomUUID()}.$extension")
  }

  /**
   * A file URI alone is not enough: the WebView must not turn this plugin into
   * a generic reader for settings, reports, or diagnostic artifacts.
   * Only imported media, prior PCM output, and task media slots are decodable.
   */
  private fun requirePrivateMediaInput(uri: String): File {
    val file = artifacts.requirePrivateInput(uri)
    val root = appContext.filesDir.canonicalFile
    val relativePath = file.toRelativeString(root).replace(File.separatorChar, '/')
    require(PrivateMediaDecodePolicy.acceptsRelativeInputPath(relativePath)) {
      "The private URI is not an approved media input."
    }
    return file
  }

  /** Task-bound media operations must not read an imported file or another task's artifacts. */
  private fun requireTaskOwnedMediaInput(taskId: String, uri: String): File {
    val normalizedTaskId = PrivateArtifactPolicy.taskDirectoryName(taskId)
    val file = requirePrivateMediaInput(uri)
    val root = appContext.filesDir.canonicalFile
    val relativePath = file.toRelativeString(root).replace(File.separatorChar, '/')
    require(TaskPrivateMediaPolicy.taskIdForRelativeInputPath(relativePath) == normalizedTaskId) {
      "The private media URI does not belong to the requested task."
    }
    return file
  }

  private fun privateRelativePath(file: File): String = file.toRelativeString(appContext.filesDir.canonicalFile)
    .replace(File.separatorChar, '/')

  private fun ensureOperationWithinDeadline(deadlineElapsedMs: Long, timeoutMessage: String) {
    ensureNotInterrupted()
    if (SystemClock.elapsedRealtime() > deadlineElapsedMs) throw MediaOperationTimeoutException(timeoutMessage)
  }

  private fun normalizedSampleFlags(value: Int): Int =
    if (value and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0

  private fun syncFile(file: File) {
    RandomAccessFile(file, "r").use { openFile -> openFile.fd.sync() }
  }

  private fun deleteQuietly(file: File) {
    runCatching { if (file.exists()) file.delete() }
  }

  private fun ensureNotInterrupted() {
    if (Thread.currentThread().isInterrupted) throw InterruptedException("Native media decode was cancelled.")
  }

  private companion object {
    const val PCM_DIRECTORY_NAME = "pcm"
    const val ASR_DIRECTORY_NAME = "asr"
    const val REMUX_DIRECTORY_NAME = "remux"
    const val REMUX_MIME_TYPE = "video/mp4"
    const val TASK_VIDEO_FILE_NAME = "video.mp4"
    const val TASK_THUMBNAIL_FILE_NAME = "thumbnail.jpg"
    const val THUMBNAIL_MAX_EDGE_PIXELS = 720
    const val THUMBNAIL_JPEG_QUALITY = 85
    const val THUMBNAIL_MIME_TYPE = "image/jpeg"
    const val MAX_THUMBNAIL_BYTES = 2L * 1_024L * 1_024L
    const val DEQUEUE_TIMEOUT_US = 10_000L
    const val MAX_SOURCE_BYTES = 1_024L * 1_024L * 1_024L
    const val MAX_DECODE_WALL_CLOCK_MS = 15L * 60L * 1_000L
    const val MAX_PCM_SOURCE_BYTES = PcmWavEncoding.HEADER_BYTES.toLong() + PcmWavEncoding.MAX_DATA_BYTES
    const val MAX_SEGMENT_WALL_CLOCK_MS = 5L * 60L * 1_000L
    const val SEGMENT_COPY_BUFFER_BYTES = 64 * 1_024
    const val MAX_REMUX_SOURCE_BYTES = 1_024L * 1_024L * 1_024L
    const val MAX_REMUX_OUTPUT_BYTES = 1_024L * 1_024L * 1_024L
    const val MAX_REMUX_WALL_CLOCK_MS = 15L * 60L * 1_000L
    const val DEFAULT_ENCODED_SAMPLE_BYTES = 1 * 1_024 * 1_024
    const val MAX_ENCODED_SAMPLE_BYTES = 16 * 1_024 * 1_024
    const val MAX_SAMPLES_PER_TRACK = 2_000_000L
    const val MAX_TRACK_TIMESTAMP_US = 6L * 60L * 60L * 1_000_000L
    const val MAX_AV_START_OFFSET_US = 2L * 1_000_000L
    const val MAX_AV_END_OFFSET_US = 10L * 1_000_000L
  }
}

private data class MediaTrackSource(
  val file: File,
  val trackIndex: Int,
  val mimeType: String,
)

private data class VideoSourceTracks(
  val video: MediaTrackSource,
  val audio: MediaTrackSource?,
)

private data class TrackSampleSummary(
  val mimeType: String,
  val sampleCount: Long,
  val firstPresentationTimeUs: Long,
  val lastPresentationTimeUs: Long,
  val timestampDigest: String,
)

private class RemuxTrackSession(
  val source: MediaTrackSource,
  val extractor: MediaExtractor,
  val muxerTrackIndex: Int,
  val buffer: ByteBuffer,
) {
  fun release() = extractor.release()
}

/** Small deterministic sequence digest avoids holding long-media timestamps in memory during output verification. */
private class TrackTimestampDigest {
  private val digest = MessageDigest.getInstance("SHA-256")
  private val buffer = ByteBuffer.allocate(16).order(ByteOrder.BIG_ENDIAN)

  fun add(presentationTimeUs: Long, sampleSize: Int, normalizedFlags: Int) {
    buffer.clear()
    buffer.putLong(presentationTimeUs)
    buffer.putInt(sampleSize)
    buffer.putInt(normalizedFlags)
    digest.update(buffer.array())
  }

  fun value(): String = digest.digest().joinToString(separator = "") { value -> "%02x".format(value.toInt() and 0xff) }
}

/** Fixed-header PCM/WAV parser for artifacts created by [AtomicPcmWavWriter]. */
private data class CanonicalPcmWavHeader(
  val sampleRateHz: Int,
  val channelCount: Int,
  val dataBytes: Long,
  val durationMs: Long,
) {
  companion object {
    fun read(source: File): CanonicalPcmWavHeader {
      require(source.isFile) { "The private PCM/WAV file is unavailable." }
      val bytes = ByteArray(PcmWavEncoding.HEADER_BYTES)
      RandomAccessFile(source, "r").use { input -> input.readFully(bytes) }
      val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      require(bytes.asciiAt(0, "RIFF") && bytes.asciiAt(8, "WAVE") && bytes.asciiAt(12, "fmt ") && bytes.asciiAt(36, "data")) {
        "The private audio is not a canonical PCM/WAV artifact."
      }
      val riffSize = header.getInt(4).toLong()
      val fmtSize = header.getInt(16)
      val audioFormat = header.getShort(20).toInt()
      val channelCount = header.getShort(22).toInt()
      val sampleRateHz = header.getInt(24)
      val byteRate = header.getInt(28).toLong()
      val blockAlign = header.getShort(32).toInt()
      val bitsPerSample = header.getShort(34).toInt()
      val dataBytes = header.getInt(40).toLong()
      require(fmtSize == 16 && audioFormat == 1 && channelCount in 1..8 && sampleRateHz in 8_000..192_000 && bitsPerSample == 16) {
        "The private audio is not a supported canonical PCM/WAV artifact."
      }
      val expectedBlockAlign = channelCount * 2
      require(blockAlign == expectedBlockAlign && byteRate == sampleRateHz.toLong() * expectedBlockAlign) {
        "The private PCM/WAV header is inconsistent."
      }
      require(dataBytes in 1..PcmWavEncoding.MAX_DATA_BYTES && dataBytes % expectedBlockAlign == 0L) {
        "The private PCM/WAV data size is invalid."
      }
      require(riffSize == 36L + dataBytes && source.length() == PcmWavEncoding.HEADER_BYTES + dataBytes) {
        "The private PCM/WAV file length is invalid."
      }
      val durationMs = ((dataBytes / expectedBlockAlign) * 1_000L) / sampleRateHz
      return CanonicalPcmWavHeader(sampleRateHz, channelCount, dataBytes, durationMs)
    }
  }
}

private fun ByteArray.asciiAt(offset: Int, expected: String): Boolean =
  expected.toByteArray(Charsets.US_ASCII).indices.all { index -> getOrNull(offset + index) == expected[index].code.toByte() }

/** Pure allowlist for the MediaCodec input boundary. */
internal object PrivateMediaDecodePolicy {
  private val approvedTaskMedia = Regex("tasks/[A-Za-z0-9][A-Za-z0-9._-]{0,119}/media/.+")

  fun acceptsRelativeInputPath(value: String): Boolean {
    val normalized = value.replace('\\', '/')
    return normalized.startsWith("media/imports/") ||
      normalized.startsWith("media/pcm/") ||
      approvedTaskMedia.matches(normalized)
  }
}

internal data class PcmWavFormat(
  val sampleRateHz: Int,
  val channelCount: Int,
  val sourceEncoding: Int,
) {
  companion object {
    fun from(format: MediaFormat): PcmWavFormat {
      val sampleRateHz = format.requiredPositiveInteger(MediaFormat.KEY_SAMPLE_RATE, "sample rate")
      val channelCount = format.requiredPositiveInteger(MediaFormat.KEY_CHANNEL_COUNT, "channel count")
      require(sampleRateHz in 8_000..192_000) { "The decoded audio sample rate is unsupported." }
      require(channelCount in 1..8) { "The decoded audio channel count is unsupported." }
      val sourceEncoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
        format.getInteger(MediaFormat.KEY_PCM_ENCODING)
      } else {
        AudioFormat.ENCODING_PCM_16BIT
      }
      require(PcmWavEncoding.isSupported(sourceEncoding)) { "The decoded PCM encoding is unsupported." }
      return PcmWavFormat(sampleRateHz, channelCount, sourceEncoding)
    }
  }
}

private fun MediaFormat.requiredPositiveInteger(key: String, displayName: String): Int {
  require(containsKey(key)) { "The decoded audio has no $displayName." }
  return getInteger(key).also { value -> require(value > 0) { "The decoded audio $displayName is invalid." } }
}

/** Atomic private WAV writer: `.part` files never become visible as output. */
private class AtomicPcmWavWriter(
  private val destination: File,
  private val format: PcmWavFormat,
) {
  private val temporary = File(destination.parentFile, ".${destination.name}.${UUID.randomUUID()}.part")
  private val stream: FileOutputStream
  private var closed = false
  var dataBytes: Long = 0L
    private set

  init {
    require(!destination.exists() && !temporary.exists()) { "The private PCM output path is already in use." }
    stream = FileOutputStream(temporary)
    stream.write(ByteArray(PcmWavEncoding.HEADER_BYTES))
  }

  fun write(source: ByteArray, sourceFormat: PcmWavFormat) {
    check(sourceFormat == format) { "Decoded PCM format changed unexpectedly." }
    val canonical = PcmWavEncoding.toSigned16LittleEndian(source, sourceFormat)
    require(dataBytes + canonical.size <= PcmWavEncoding.MAX_DATA_BYTES) {
      "The decoded PCM audio exceeds the private storage limit."
    }
    stream.write(canonical)
    dataBytes += canonical.size
  }

  fun finish(): PcmWavOutput {
    require(dataBytes > 0L) { "The decoded PCM audio is empty." }
    closeStream()
    RandomAccessFile(temporary, "rw").use { file ->
      file.seek(0L)
      file.write(PcmWavEncoding.header(format, dataBytes))
      file.fd.sync()
    }
    if (!temporary.renameTo(destination)) {
      throw MediaDecodeException("Could not finalize private PCM audio.")
    }
    return PcmWavOutput(
      uri = Uri.fromFile(destination).toString(),
      sizeBytes = destination.length(),
      sampleRateHz = format.sampleRateHz,
      channelCount = format.channelCount,
    )
  }

  fun abort() {
    runCatching { closeStream() }
    if (temporary.exists()) temporary.delete()
  }

  private fun closeStream() {
    if (closed) return
    stream.fd.sync()
    stream.close()
    closed = true
  }
}

/** Pure PCM/WAV conversion helpers, unit-tested without an Android device. */
internal object PcmWavEncoding {
  const val HEADER_BYTES = 44
  const val MAX_DATA_BYTES = 128L * 1_024L * 1_024L

  fun isSupported(encoding: Int): Boolean = encoding == AudioFormat.ENCODING_PCM_8BIT ||
    encoding == AudioFormat.ENCODING_PCM_16BIT ||
    encoding == AudioFormat.ENCODING_PCM_FLOAT ||
    encoding == AudioFormat.ENCODING_PCM_24BIT_PACKED ||
    encoding == AudioFormat.ENCODING_PCM_32BIT

  fun toSigned16LittleEndian(source: ByteArray, format: PcmWavFormat): ByteArray {
    val bytesPerSample = when (format.sourceEncoding) {
      AudioFormat.ENCODING_PCM_8BIT -> 1
      AudioFormat.ENCODING_PCM_16BIT -> 2
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
      AudioFormat.ENCODING_PCM_32BIT, AudioFormat.ENCODING_PCM_FLOAT -> 4
      else -> throw IllegalArgumentException("Unsupported PCM encoding.")
    }
    require(source.size % (bytesPerSample * format.channelCount) == 0) {
      "Decoded PCM data is not frame aligned."
    }
    if (format.sourceEncoding == AudioFormat.ENCODING_PCM_16BIT) return source

    val sampleCount = source.size / bytesPerSample
    val output = ByteBuffer.allocate(sampleCount * 2).order(ByteOrder.LITTLE_ENDIAN)
    when (format.sourceEncoding) {
      AudioFormat.ENCODING_PCM_8BIT -> source.forEach { value ->
        output.putShort((((value.toInt() and 0xff) - 128) shl 8).toShort())
      }
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
        var offset = 0
        while (offset < source.size) {
          val value = (source[offset].toInt() and 0xff) or
            ((source[offset + 1].toInt() and 0xff) shl 8) or
            (source[offset + 2].toInt() shl 16)
          output.putShort((value shr 8).toShort())
          offset += 3
        }
      }
      AudioFormat.ENCODING_PCM_32BIT -> {
        val input = ByteBuffer.wrap(source).order(ByteOrder.LITTLE_ENDIAN)
        while (input.hasRemaining()) output.putShort((input.int shr 16).toShort())
      }
      AudioFormat.ENCODING_PCM_FLOAT -> {
        val input = ByteBuffer.wrap(source).order(ByteOrder.LITTLE_ENDIAN)
        while (input.hasRemaining()) {
          val sample = input.float
          val bounded = if (sample.isFinite()) sample.coerceIn(-1f, 1f) else 0f
          output.putShort((bounded * 32_767f).roundToInt().toShort())
        }
      }
    }
    return output.array()
  }

  fun header(format: PcmWavFormat, dataBytes: Long): ByteArray {
    require(dataBytes in 1..MAX_DATA_BYTES) { "WAV data size is invalid." }
    val byteRate = format.sampleRateHz.toLong() * format.channelCount * 2L
    require(byteRate <= Int.MAX_VALUE) { "WAV byte rate is invalid." }
    val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt((36L + dataBytes).toInt())
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1)
    header.putShort(format.channelCount.toShort())
    header.putInt(format.sampleRateHz)
    header.putInt(byteRate.toInt())
    header.putShort((format.channelCount * 2).toShort())
    header.putShort(16)
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(dataBytes.toInt())
    return header.array()
  }
}

private fun ByteBuffer.copyRange(offset: Int, size: Int): ByteArray {
  require(offset >= 0 && size >= 0 && offset <= limit() && size <= limit() - offset) {
    "The media decoder returned an invalid output buffer range."
  }
  val duplicate = duplicate()
  duplicate.position(offset)
  duplicate.limit(offset + size)
  return ByteArray(size).also(duplicate::get)
}
