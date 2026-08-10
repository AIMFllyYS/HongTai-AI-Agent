package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal data class ProductionRenderResult(val uri: String, val sizeBytes: Long, val durationSeconds: Double)

@UnstableApi
internal class ProductionRenderer(private val context: Context, private val store: ProductionMediaStore) {
  fun render(projectId: String, plan: NativeProductionPlan, onProgress: (Int, String) -> Unit): ProductionRenderResult {
    onProgress(5, if (plan.renderMode == ProductionRenderMode.AVATAR) "正在校验数字人口播原声" else "正在生成旁白")
    val narration = if (plan.renderMode == ProductionRenderMode.MONTAGE) synthesize(projectId, plan) else emptyList()
    onProgress(25, "正在编排镜头")
    val composition = compile(plan, narration)
    val (temporary, output) = store.outputTarget(projectId)
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
    onProgress(35, "正在本地合成")
    var elapsedMs = 0L
    while (!finished.await(500, TimeUnit.MILLISECONDS)) {
      elapsedMs += 500L
      if (elapsedMs >= RENDER_TIMEOUT_MS) {
        handler.post { transformerRef.get()?.cancel() }
        throw ProductionException(ProductionFailureKind.MEDIA_RENDER_TIMEOUT, "Media3 production export timed out.")
      }
      val transformer = transformerRef.get() ?: continue
      handler.post {
        val holder = ProgressHolder()
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          onProgress(35 + (holder.progress * 0.64f).toInt(), "正在本地合成")
        }
      }
    }
    failure.get()?.let { throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "Media3 production export failed.", it) }
    if (!temporary.isFile || temporary.length() <= 0L) throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "Media3 production export is empty.")
    // Verify the temporary export before replacing a previous successful
    // output. A codec/container failure must leave that existing MP4 intact.
    val durationSeconds = verifyOutput(temporary)
    finalizeOutput(temporary, output)
    onProgress(100, "成片已保存")
    return ProductionRenderResult(Uri.fromFile(output).toString(), output.length(), durationSeconds)
  }

  private fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>> {
    val initialized = CountDownLatch(1)
    val status = AtomicReference(TextToSpeech.ERROR)
    val engine = TextToSpeech(context) { value -> status.set(value); initialized.countDown() }
    try {
      if (!initialized.await(15, TimeUnit.SECONDS) || status.get() != TextToSpeech.SUCCESS) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "System TTS is unavailable.")
      }
      val requestedLocale = Locale.forLanguageTag(plan.voiceLocale)
      if (engine.setLanguage(requestedLocale) < TextToSpeech.LANG_AVAILABLE) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "The requested system TTS language is unavailable.")
      }
      if (!selectSystemVoice(engine, requestedLocale)) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "No compatible Chinese system TTS voice is available.")
      }
      if (engine.setSpeechRate(plan.speechRate) != TextToSpeech.SUCCESS) {
        throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "The system TTS speech rate is unavailable.")
      }
      return plan.shots.map { shot -> synthesizeShot(engine, requestedLocale, projectId, shot) to shot.durationMs }
    } finally {
      engine.shutdown()
    }
  }

  /**
   * Prefer an installed/offline voice, but do not reject a functioning system
   * TTS engine solely because its provider performs its own network retrieval.
   * The latter is still a real Android system TTS operation and is substantially
   * more compatible with devices that ship no downloadable offline Chinese pack.
   */
  private fun selectSystemVoice(engine: TextToSpeech, locale: Locale): Boolean {
    val compatible = engine.voices?.filter { candidate -> candidate.locale.language == locale.language }
    if (compatible.isNullOrEmpty()) return engine.voice?.locale?.language == locale.language
    val voice = compatible.firstOrNull { !it.isNetworkConnectionRequired } ?: compatible.first()
    return try {
      engine.voice = voice
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun synthesizeShot(engine: TextToSpeech, locale: Locale, projectId: String, shot: ProductionShot): File {
    var firstFailure: ProductionException? = null
    repeat(2) { attempt ->
      try {
        return synthesizeShotAttempt(engine, projectId, shot)
      } catch (error: ProductionException) {
        if (error.kind == ProductionFailureKind.TTS_UNAVAILABLE) throw error
        if (attempt == 1) throw error
        firstFailure = error
        Thread.sleep(750)
        selectSystemVoice(engine, locale)
      }
    }
    throw checkNotNull(firstFailure)
  }

  private fun synthesizeShotAttempt(engine: TextToSpeech, projectId: String, shot: ProductionShot): File {
    val output = File(store.audioDirectory(projectId), "narration-${shot.order}.wav")
    if (output.exists() && !output.delete()) throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not replace a previous TTS segment.")
    val finished = CountDownLatch(1)
    val failure = AtomicReference<String?>()
    val utteranceId = "production-$projectId-${shot.order}"
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) = Unit
      override fun onDone(id: String?) { if (id == utteranceId) finished.countDown() }
      @Deprecated("Deprecated in Java") override fun onError(id: String?) { if (id == utteranceId) { failure.set("TTS synthesis failed."); finished.countDown() } }
      override fun onError(id: String?, errorCode: Int) { if (id == utteranceId) { failure.set("TTS synthesis failed with code $errorCode."); finished.countDown() } }
    })
    if (engine.synthesizeToFile(shot.narration, Bundle(), output, utteranceId) != TextToSpeech.SUCCESS) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not start system TTS synthesis.")
    }
    if (!finished.await(30, TimeUnit.SECONDS)) throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "System TTS synthesis timed out.")
    if (failure.get() != null || !output.isFile || output.length() <= 0L) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, failure.get() ?: "System TTS produced no audio.")
    }
    return output
  }

  private fun compile(plan: NativeProductionPlan, narration: List<Pair<File, Long>>): Composition {
    val visualItems = if (plan.renderMode == ProductionRenderMode.AVATAR) avatarVisualItems(plan) else plan.shots.flatMap { shot -> visualItems(plan, shot) }
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
  private fun avatarVisualItems(plan: NativeProductionPlan): List<EditedMediaItem> {
    var sourceOffsetMs = 0L
    return plan.shots.flatMap { shot ->
      visualItems(plan, shot, sourceOffsetMs).also { sourceOffsetMs += shot.durationMs }
    }
  }

  private fun visualItems(plan: NativeProductionPlan, shot: ProductionShot, sourceOffsetMs: Long = 0L): List<EditedMediaItem> {
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
      val overlay = OverlayEffect(captionOverlays(shot.caption))
      EditedMediaItem.Builder(media).setRemoveAudio(plan.renderMode == ProductionRenderMode.MONTAGE)
        .apply { if (shot.input.kind == ProductionAssetKind.IMAGE) setFrameRate(plan.fps) }
        .setEffects(Effects(emptyList(), listOf(presentation, overlay))).build()
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
      if (MimeTypes.VIDEO_H264 !in mimes || MimeTypes.AUDIO_AAC !in mimes) {
        throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "The production output is not H.264/AAC MP4.")
      }
      durationSeconds(file).also { duration ->
        if (duration <= 0.0) throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "The production output has no duration.")
      }
    } catch (error: ProductionException) {
      throw error
    } catch (error: Exception) {
      throw ProductionException(ProductionFailureKind.MEDIA_EXPORT_FAILED, "The production output could not be verified.", error)
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

  private companion object {
    const val RENDER_TIMEOUT_MS = 180_000L
  }
}
