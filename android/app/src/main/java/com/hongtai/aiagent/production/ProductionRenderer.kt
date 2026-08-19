package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.DefaultGainProvider
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.effect.TextureOverlay
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
  fun render(
    projectId: String,
    plan: NativeProductionPlan,
    narrationSynthesizer: NarrationSynthesizer = SystemNarrationSynthesizer(context, store),
    onProgress: (Int, String) -> Unit,
  ): ProductionRenderResult {
    val progress = ProductionRenderProgressGate(onProgress)
    progress.emit(5, if (plan.renderMode == ProductionRenderMode.AVATAR) ProductionRenderStage.VALIDATE_AVATAR_AUDIO.wireName else ProductionRenderStage.SYNTHESIZE_NARRATION.wireName)
    val narration = if (plan.renderMode == ProductionRenderMode.MONTAGE) narrationSynthesizer.synthesize(projectId, plan) else emptyList()
    progress.emit(25, ProductionRenderStage.COMPILE_SHOTS.wireName)
    val composition = compile(plan, narration)
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

  private fun compile(plan: NativeProductionPlan, narration: List<Pair<File, Long>>): Composition {
    val stickers = decodeStickers(plan)
    val visualItems = if (plan.renderMode == ProductionRenderMode.AVATAR) {
      avatarVisualItems(plan, stickers)
    } else {
      plan.shots.flatMap { shot -> visualItems(plan, shot, stickers = stickers) }
    }
    val sequences = mutableListOf(EditedMediaItemSequence.withVideoFrom(visualItems))
    if (plan.renderMode == ProductionRenderMode.MONTAGE) {
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
    val durations = when (shot.input.kind) {
      ProductionAssetKind.IMAGE -> listOf(shot.durationMs)
      ProductionAssetKind.VIDEO -> {
        val source = requireNotNull(shot.input.durationMs).coerceAtLeast(1L)
        buildList { var remaining = shot.durationMs; while (remaining > 0L) { val part = minOf(source, remaining); add(part); remaining -= part } }
      }
      ProductionAssetKind.AUDIO -> error("Audio cannot be used as a visual shot.")
    }
    return durations.map { duration ->
      val media = MediaItem.Builder().setUri(File(shot.input.path).toURI().toString()).apply {
        if (shot.input.kind == ProductionAssetKind.IMAGE) setImageDurationMs(duration)
        else { setClipStartPositionMs(sourceOffsetMs); setClipEndPositionMs(sourceOffsetMs + duration) }
      }.build()
      val presentation = Presentation.createForWidthAndHeight(
        plan.width, plan.height,
        if (shot.fit == "cover") Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP else Presentation.LAYOUT_SCALE_TO_FIT,
      )
      val overlay = OverlayEffect(headlineOverlays(plan.textOverlay) + subtitleOverlays(plan, shot, shotOffsetMs, stickers))
      shotOffsetMs += duration
      EditedMediaItem.Builder(media).setRemoveAudio(plan.renderMode == ProductionRenderMode.MONTAGE)
        .apply { if (shot.input.kind == ProductionAssetKind.IMAGE) setFrameRate(plan.fps) }
        .setEffects(Effects(emptyList(), listOf(presentation, overlay))).build()
    }
  }

  /**
   * v3 plans burn a template driven caption plus its bounded decorations; older plans keep the
   * static caption they were exported with so a re-render of an old project looks unchanged.
   *
   * @param shotOffsetMs where this media item starts inside its shot, which is non-zero only when a
   *   clip shorter than the shot is repeated to fill it.
   */
  private fun subtitleOverlays(
    plan: NativeProductionPlan,
    shot: ProductionShot,
    shotOffsetMs: Long,
    stickers: Map<String, Bitmap>,
  ): List<TextureOverlay> {
    val template = plan.subtitleTemplate ?: return captionOverlays(shot.caption)
    val decorations = plan.decorations.filter { it.shotOrder == shot.order }.map { decoration ->
      ProductionDecorationOverlay(
        decoration,
        template,
        plan.width,
        plan.height,
        shotOffsetMs,
        decoration.assetRef?.let(stickers::get),
      )
    }
    return listOf(ProductionCaptionOverlay(template, shot.cues, plan.width, plan.height, shotOffsetMs)) + decorations
  }

  private fun decodeStickers(plan: NativeProductionPlan): Map<String, Bitmap> {
    val ids = plan.decorations.mapNotNull { spec -> spec.assetRef.takeIf { spec.kind == "sticker" } }.toSet()
    return ids.associateWith { DecorationAssets.decode(context.assets, it) }
  }

  private fun headlineOverlays(value: ProductionTextOverlay): List<TextOverlay> {
    if (value.primaryText.isBlank()) return emptyList()
    val combined = listOfNotNull(value.primaryText, value.secondaryText).joinToString("\n")
    val secondaryStart = value.secondaryText?.let { value.primaryText.length + 1 }
    fun styledText(foreground: Int, background: Int?): SpannableString = SpannableString(combined).apply {
      setSpan(ForegroundColorSpan(foreground), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      background?.let { setSpan(BackgroundColorSpan(it), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
      setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(AbsoluteSizeSpan(54), 0, secondaryStart ?: length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      secondaryStart?.let { setSpan(AbsoluteSizeSpan(34), it, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    }
    val mainSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, 0.72f).setOverlayFrameAnchor(0f, 0f).build()
    return when (value.preset) {
      "clean_card" -> listOf(TextOverlay.createStaticTextOverlay(styledText(Color.rgb(18, 34, 31), Color.argb(224, 255, 255, 255)), mainSettings))
      "aqua_accent" -> listOf(TextOverlay.createStaticTextOverlay(styledText(Color.rgb(100, 244, 218), Color.argb(205, 0, 37, 34)), mainSettings))
      else -> {
        val shadowSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0.014f, 0.706f).setOverlayFrameAnchor(0f, 0f).build()
        listOf(
          TextOverlay.createStaticTextOverlay(styledText(Color.argb(225, 0, 0, 0), null), shadowSettings),
          TextOverlay.createStaticTextOverlay(styledText(Color.WHITE, null), mainSettings),
        )
      }
    }
  }

  private fun captionOverlays(value: String): List<TextOverlay> {
    val shadow = SpannableString("  ▌  $value  ").apply {
      setSpan(ForegroundColorSpan(Color.argb(210, 0, 0, 0)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(BackgroundColorSpan(Color.argb(220, 0, 24, 21)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(AbsoluteSizeSpan(42), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val foreground = SpannableString("  ▌  $value  ").apply {
      setSpan(ForegroundColorSpan(Color.WHITE), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(ForegroundColorSpan(Color.rgb(126, 189, 172)), 2, 3, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(BackgroundColorSpan(Color.argb(196, 0, 48, 42)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(AbsoluteSizeSpan(42), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val shadowSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0.012f, -0.708f).setOverlayFrameAnchor(0f, 0f).build()
    val foregroundSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, -0.72f).setOverlayFrameAnchor(0f, 0f).build()
    return listOf(
      TextOverlay.createStaticTextOverlay(shadow, shadowSettings),
      TextOverlay.createStaticTextOverlay(foreground, foregroundSettings),
    )
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
