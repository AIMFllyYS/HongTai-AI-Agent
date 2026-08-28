package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.DefaultGainProvider
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.EncoderSelector
import androidx.media3.transformer.EncoderUtil
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

internal data class ProductionRenderResult(val uri: String, val sizeBytes: Long, val durationSeconds: Double)

@UnstableApi
internal class ProductionRenderer(private val context: Context, private val store: ProductionMediaStore) {
  /**
   * @param narrationAssets sentenceId → project-relative audio path synthesized by the front-loaded
   *   narration stage. When present (montage and v4 avatar), rendering skips TTS entirely and
   *   consumes the existing files in shot order; when null, the legacy render-time synthesis path
   *   runs unchanged.
   */
  fun render(
    projectId: String,
    plan: NativeProductionPlan,
    narrationSynthesizer: NarrationSynthesizer = SystemNarrationSynthesizer(context, store),
    narrationAssets: Map<String, String>? = null,
    onProgress: (Int, String) -> Unit,
  ): ProductionRenderResult {
    // Legacy v3 avatar plans carry no narration assets: they keep the recording's original audio
    // and its validation stage. A v4 avatar plan renders like montage — our own TTS track over a
    // muted, window-planned visual sequence cut from the single avatar video.
    val legacyAvatarAudio = plan.renderMode == ProductionRenderMode.AVATAR && narrationAssets == null
    val progress = ProductionRenderProgressGate(onProgress)
    // Audio-ready renders never emit a synthesis stage: that work already happened in the
    // front-loaded stage, and a fake synthesize_narration event would misreport real progress.
    progress.emit(
      5,
      when {
        legacyAvatarAudio -> ProductionRenderStage.VALIDATE_AVATAR_AUDIO.wireName
        narrationAssets != null -> ProductionRenderStage.COMPILE_SHOTS.wireName
        else -> ProductionRenderStage.SYNTHESIZE_NARRATION.wireName
      },
    )
    val narration = when {
      legacyAvatarAudio -> emptyList()
      narrationAssets != null -> ProductionNarrationAssets.resolve(plan, narrationAssets) { path ->
        store.resolveProjectRelative(projectId, path)
      }
      else -> narrationSynthesizer.synthesize(projectId, plan)
    }
    if (legacyAvatarAudio || narrationAssets == null) {
      progress.emit(25, ProductionRenderStage.COMPILE_SHOTS.wireName)
    }
    val composition = compile(plan, narration, legacyAvatarAudio)
    val (temporary, output) = store.outputTarget(projectId)
    progress.emit(35, ProductionRenderStage.EXPORT.wireName)
    var attempt = exportOnce(composition, temporary, progress, softwareOnly = false)
    var resolution = ProductionRenderTimeoutPolicy.resolve(attempt.watch, attempt.failure, attempt.temporaryUsable)
    if (
      resolution == ProductionExportResolution.ExportFailed &&
      ProductionExportFailureClassifier.shouldRetryWithSoftware(exportFailureKind(attempt.failure), alreadyTriedSoftware = false)
    ) {
      attempt = exportOnce(composition, temporary, progress, softwareOnly = true)
      resolution = ProductionRenderTimeoutPolicy.resolve(attempt.watch, attempt.failure, attempt.temporaryUsable)
    }
    when (resolution) {
      ProductionExportResolution.Timeout -> {
        val stopped = (attempt.watch as? ProductionExportWatchResult.TimedOut)?.exportStopped == true
        ProductionRenderTimeoutPolicy.discardIncompletePart(temporary, stopped)
        throw ProductionException(ProductionFailureKind.MEDIA_RENDER_TIMEOUT, "Media3 production export timed out.")
      }
      ProductionExportResolution.ExportFailed -> {
        progress.close()
        val kind = exportFailureKind(attempt.failure)
        attempt.failure?.let { throw ProductionException(kind, "Media3 production export failed.", it) }
        throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "Media3 production export is empty.")
      }
      ProductionExportResolution.ReadyToVerify -> {
        // Verify the temporary export before replacing a previous successful
        // output. A codec/container failure must leave that existing MP4 intact.
        val durationSeconds = verifyOutput(temporary)
        finalizeOutput(temporary, output)
        progress.emit(100, ProductionRenderStage.SAVED.wireName)
        return ProductionRenderResult(Uri.fromFile(output).toString(), output.length(), durationSeconds)
      }
    }
  }

  private data class ProductionExportAttempt(
    val watch: ProductionExportWatchResult,
    val failure: Throwable?,
    val temporaryUsable: Boolean,
  )

  private fun exportOnce(
    composition: Composition,
    temporary: File,
    progress: ProductionRenderProgressGate,
    softwareOnly: Boolean,
  ): ProductionExportAttempt {
    temporary.delete()
    val failure = AtomicReference<Throwable?>()
    val finished = CountDownLatch(1)
    val handler = Handler(Looper.getMainLooper())
    val transformerRef = AtomicReference<Transformer?>()
    handler.post {
      try {
        val transformer = Transformer.Builder(context)
          .setVideoMimeType(MimeTypes.VIDEO_H264)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .setEncoderFactory(h264EncoderFactory(softwareOnly))
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, exportResult: ExportResult) { finished.countDown() }
            override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
              failure.set(exportException)
              finished.countDown()
            }
          }).build()
        transformerRef.set(transformer)
        transformer.start(composition, temporary.absolutePath)
      } catch (error: Throwable) {
        failure.set(error)
        finished.countDown()
      }
    }
    val watch = ProductionExportWatchdog(progress).awaitExport(
      finished,
      onPoll = {
        progress.flushPending()
        val transformer = transformerRef.get()
        if (transformer != null) {
          handler.post {
            val holder = ProgressHolder()
            if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
              progress.offerSample(35 + (holder.progress * 0.64f).toInt(), ProductionRenderStage.EXPORT.wireName)
            }
          }
        }
      },
      onTimeout = {
        awaitExportStopAfterCancel(
          postCancel = { action -> handler.post(action) },
          cancel = { transformerRef.get()?.cancel() },
          finished = finished,
        )
      },
    )
    return ProductionExportAttempt(watch, failure.get(), temporary.isFile && temporary.length() > 0L)
  }

  private fun h264EncoderFactory(softwareOnly: Boolean): DefaultEncoderFactory =
    DefaultEncoderFactory.Builder(context)
      .setVideoEncoderSelector(h264EncoderSelector(softwareOnly))
      .setEnableFallback(false)
      .build()

  /** Hardware H.264 first, then software H.264. MIME rewrite to HEVC is forbidden. */
  private fun h264EncoderSelector(softwareOnly: Boolean): EncoderSelector = EncoderSelector { mimeType ->
    val supported = EncoderUtil.getSupportedEncoders(mimeType)
    val hardware = supported.filter { EncoderUtil.isHardwareAccelerated(it, mimeType) }
    val software = supported.filter { !EncoderUtil.isHardwareAccelerated(it, mimeType) }
    ImmutableList.copyOf(if (softwareOnly) software else hardware + software)
  }

  private fun exportFailureKind(error: Throwable?): ProductionFailureKind {
    val code = (error as? ExportException)?.errorCode ?: return ProductionFailureKind.MEDIA_EXPORT_FAILED
    return ProductionExportFailureClassifier.classifyExport(code)
  }

  private fun compile(plan: NativeProductionPlan, narration: List<Pair<File, Long>>, legacyAvatarAudio: Boolean): Composition {
    val stickers = decodeStickers(plan)
    val visualItems = if (plan.renderMode == ProductionRenderMode.AVATAR) {
      avatarVisualItems(plan, stickers)
    } else {
      plan.shots.flatMap { shot -> visualItems(plan, shot, stickers = stickers) }
    }
    val sequences = mutableListOf(
      if (legacyAvatarAudio) {
        EditedMediaItemSequence.withAudioAndVideoFrom(visualItems)
      } else {
        EditedMediaItemSequence.withVideoFrom(visualItems)
      },
    )
    // Everything except legacy avatar mixes narration as its own audio sequence: montage always
    // did, and a v4 avatar plan's own TTS track replaces the recording's original sound.
    if (!legacyAvatarAudio) {
      sequences += EditedMediaItemSequence.withAudioFrom(narration.map { (file, maximumDurationMs) ->
        val media = MediaItem.Builder().setUri(file.toURI().toString()).setClipEndPositionMs(maximumDurationMs).build()
        EditedMediaItem.Builder(media).setRemoveVideo(true).build()
      })
      plan.backgroundMusic?.let { music ->
        val gain = GainProcessor(DefaultGainProvider.Builder(plan.backgroundMusicVolume).build())
        val item = EditedMediaItem.Builder(MediaItem.fromUri(File(music.path).toURI().toString()))
          .setRemoveVideo(true).setEffects(Effects(listOf(gain), emptyList())).build()
        sequences += EditedMediaItemSequence.Builder(listOf(item)).setIsLooping(true).build()
      }
    }
    return Composition.Builder(sequences).build()
  }

  /** Avatar subtitle cues trim sequential portions of its one original video instead of replaying from 0. */
  private fun avatarVisualItems(plan: NativeProductionPlan, stickers: Map<String, Bitmap>): List<EditedMediaItem> {
    var sourceOffsetMs = 0L
    return plan.shots.flatMap { shot ->
      // v4 avatar shots consume their planner-baked windows verbatim (the offset is ignored);
      // only legacy v3 avatar shots keep the sequential-accumulation offset of the old path.
      visualItems(plan, shot, sourceOffsetMs, stickers).also { sourceOffsetMs += shot.durationMs }
    }
  }

  private fun visualItems(
    plan: NativeProductionPlan,
    shot: ProductionShot,
    sourceOffsetMs: Long = 0L,
    stickers: Map<String, Bitmap>,
  ): List<EditedMediaItem> {
    var shotOffsetMs = 0L
    // Source-local clip list. v4 avatar shots carry planner-baked windows that may loop or wrap
    // the single source video (10 s of footage can carry a 30 s narration); every other shot
    // derives its clips here — images hold the whole shot, videos replay from their offset.
    val clips: List<Pair<Long, Long>> = when {
      shot.sourceWindows.isNotEmpty() -> shot.sourceWindows.map { it.startMs to it.endMs }
      shot.input.kind == ProductionAssetKind.IMAGE -> listOf(0L to shot.durationMs)
      shot.input.kind == ProductionAssetKind.VIDEO -> {
        val source = requireNotNull(shot.input.durationMs).coerceAtLeast(1L)
        buildList {
          var remaining = shot.durationMs
          while (remaining > 0L) {
            val part = minOf(source, remaining)
            add(sourceOffsetMs to sourceOffsetMs + part)
            remaining -= part
          }
        }
      }
      else -> error("Audio cannot be used as a visual shot.")
    }
    return clips.map { (startMs, endMs) ->
      val duration = endMs - startMs
      val media = MediaItem.Builder().setUri(File(shot.input.path).toURI().toString()).apply {
        if (shot.input.kind == ProductionAssetKind.IMAGE) setImageDurationMs(duration)
        else { setClipStartPositionMs(startMs); setClipEndPositionMs(endMs) }
      }.build()
      val presentation = Presentation.createForWidthAndHeight(
        plan.width, plan.height,
        if (shot.fit == "cover") Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP else Presentation.LAYOUT_SCALE_TO_FIT,
      )
      val overlay = OverlayEffect(headlineOverlays(plan.textOverlay) + productionShotOverlays(plan, shot, shotOffsetMs, stickers))
      shotOffsetMs += duration
      // Window-planned avatar slices are silent wallpaper under our own TTS track; legacy avatar
      // keeps the recording's original audio, and montage always mixed its narration separately.
      EditedMediaItem.Builder(media)
        .setRemoveAudio(shot.sourceWindows.isNotEmpty() || plan.renderMode == ProductionRenderMode.MONTAGE)
        .apply { if (shot.input.kind == ProductionAssetKind.IMAGE) setFrameRate(plan.fps) }
        .setEffects(Effects(emptyList(), listOf(presentation, overlay))).build()
    }
  }

  private fun decodeStickers(plan: NativeProductionPlan): Map<String, Bitmap> {
    val ids = plan.decorations.mapNotNull { spec -> spec.assetRef.takeIf { spec.kind == "sticker" } }.toSet()
    val decoded = linkedMapOf<String, Bitmap>()
    try {
      for (id in ids) decoded[id] = DecorationAssets.decode(context.assets, id)
    } catch (error: Exception) {
      decoded.values.forEach { bitmap -> if (!bitmap.isRecycled) bitmap.recycle() }
      throw error
    }
    return decoded
  }

  private fun finalizeOutput(temporary: File, output: File) {
    val backup = File(output.parentFile, ".output.previous.mp4")
    if (backup.exists() && !backup.delete()) {
      throw ProductionException(ProductionFailureKind.OUTPUT_FINALIZATION_FAILED, "Could not clear a stale production backup.")
    }
    var previousMoved = false
    try {
      if (output.exists()) {
        if (!output.renameTo(backup)) throw ProductionException(ProductionFailureKind.OUTPUT_FINALIZATION_FAILED, "Could not preserve the previous production output.")
        previousMoved = true
      }
      if (!temporary.renameTo(output)) throw ProductionException(ProductionFailureKind.OUTPUT_FINALIZATION_FAILED, "Could not finalize the production output.")
      if (backup.exists()) backup.delete()
    } catch (error: ProductionException) {
      if (previousMoved && !output.exists()) backup.renameTo(output)
      throw error
    }
  }

  private fun verifyOutput(file: File): Double {
    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(file.absolutePath)
      val mimes = (0 until extractor.trackCount).map { index -> extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME) }
      if (MimeTypes.VIDEO_H264 !in mimes) {
        throw ProductionException(
          ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.MISSING_VIDEO_H264),
          "The production output is not H.264 MP4.",
        )
      }
      if (MimeTypes.AUDIO_AAC !in mimes) {
        throw ProductionException(
          ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.MISSING_AUDIO_AAC),
          "The production output has no AAC audio track.",
        )
      }
      durationSeconds(file).also { duration ->
        if (duration <= 0.0) {
          throw ProductionException(
            ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.NO_DURATION),
            "The production output has no duration.",
          )
        }
      }
    } catch (error: ProductionException) {
      throw error
    } catch (error: Exception) {
      throw ProductionException(
        ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.UNREADABLE),
        "The production output could not be verified.",
        error,
      )
    } finally {
      extractor.release()
    }
  }

  private fun durationSeconds(file: File): Double {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1_000.0
    } finally { retriever.release() }
  }

}
