package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
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
    onProgress(5, "正在生成旁白")
    val narration = synthesize(projectId, plan)
    onProgress(25, "正在编排镜头")
    val composition = compile(plan, narration)
    val (temporary, output) = store.outputTarget(projectId)
    temporary.delete()
    val failure = AtomicReference<ExportException?>()
    val finished = CountDownLatch(1)
    val handler = Handler(Looper.getMainLooper())
    val transformerRef = AtomicReference<Transformer?>()
    handler.post {
      val transformer = Transformer.Builder(context)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) { finished.countDown() }
          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            failure.set(exportException)
            finished.countDown()
          }
        }).build()
      transformerRef.set(transformer)
      transformer.start(composition, temporary.absolutePath)
    }
    onProgress(35, "正在本地合成")
    while (!finished.await(500, TimeUnit.MILLISECONDS)) {
      val transformer = transformerRef.get() ?: continue
      handler.post {
        val holder = ProgressHolder()
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          onProgress(35 + (holder.progress * 0.64f).toInt(), "正在本地合成")
        }
      }
    }
    failure.get()?.let { throw IllegalStateException("Media3 production export failed.", it) }
    require(temporary.isFile && temporary.length() > 0L) { "Media3 production export is empty." }
    if (output.exists() && !output.delete()) throw IllegalStateException("Could not replace the previous production output.")
    if (!temporary.renameTo(output)) throw IllegalStateException("Could not finalize the production output.")
    val durationSeconds = durationSeconds(output)
    onProgress(100, "成片已保存")
    return ProductionRenderResult(Uri.fromFile(output).toString(), output.length(), durationSeconds)
  }

  private fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>> {
    val initialized = CountDownLatch(1)
    val status = AtomicReference(TextToSpeech.ERROR)
    val engine = TextToSpeech(context) { value -> status.set(value); initialized.countDown() }
    try {
      if (!initialized.await(15, TimeUnit.SECONDS) || status.get() != TextToSpeech.SUCCESS) throw IllegalStateException("System TTS is unavailable.")
      val requestedLocale = Locale.forLanguageTag(plan.voiceLocale)
      if (engine.setLanguage(requestedLocale) < TextToSpeech.LANG_AVAILABLE) throw IllegalStateException("The requested system TTS language is unavailable.")
      selectOfflineVoice(engine, requestedLocale)
      if (engine.setSpeechRate(plan.speechRate) != TextToSpeech.SUCCESS) throw IllegalStateException("The system TTS speech rate is unavailable.")
      return plan.shots.map { shot -> synthesizeShot(engine, requestedLocale, projectId, shot) to shot.durationMs }
    } finally {
      engine.shutdown()
    }
  }

  private fun selectOfflineVoice(engine: TextToSpeech, locale: Locale) {
    engine.voices?.firstOrNull { voice ->
      voice.locale.language == locale.language && !voice.isNetworkConnectionRequired
    }?.let { voice -> engine.voice = voice }
  }

  private fun synthesizeShot(engine: TextToSpeech, locale: Locale, projectId: String, shot: ProductionShot): File {
    var firstFailure: IllegalStateException? = null
    repeat(2) { attempt ->
      try {
        return synthesizeShotAttempt(engine, projectId, shot)
      } catch (error: IllegalStateException) {
        if (attempt == 1) throw error
        firstFailure = error
        Thread.sleep(750)
        selectOfflineVoice(engine, locale)
      }
    }
    throw checkNotNull(firstFailure)
  }

  private fun synthesizeShotAttempt(engine: TextToSpeech, projectId: String, shot: ProductionShot): File {
    val output = File(store.audioDirectory(projectId), "narration-${shot.order}.wav")
    if (output.exists() && !output.delete()) throw IllegalStateException("Could not replace a previous TTS segment.")
    val finished = CountDownLatch(1)
    val failure = AtomicReference<String?>()
    val utteranceId = "production-$projectId-${shot.order}"
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) = Unit
      override fun onDone(id: String?) { if (id == utteranceId) finished.countDown() }
      @Deprecated("Deprecated in Java") override fun onError(id: String?) { if (id == utteranceId) { failure.set("TTS synthesis failed."); finished.countDown() } }
      override fun onError(id: String?, errorCode: Int) { if (id == utteranceId) { failure.set("TTS synthesis failed with code $errorCode."); finished.countDown() } }
    })
    if (engine.synthesizeToFile(shot.narration, Bundle(), output, utteranceId) != TextToSpeech.SUCCESS) throw IllegalStateException("Could not start system TTS synthesis.")
    if (!finished.await(30, TimeUnit.SECONDS)) throw IllegalStateException("System TTS synthesis timed out.")
    if (failure.get() != null || !output.isFile || output.length() <= 0L) throw IllegalStateException(failure.get() ?: "System TTS produced no audio.")
    return output
  }

  private fun compile(plan: NativeProductionPlan, narration: List<Pair<File, Long>>): Composition {
    val visualItems = plan.shots.flatMap { shot -> visualItems(plan, shot) }
    val sequences = mutableListOf(EditedMediaItemSequence.withVideoFrom(visualItems))
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
    return Composition.Builder(sequences).build()
  }

  private fun visualItems(plan: NativeProductionPlan, shot: ProductionShot): List<EditedMediaItem> {
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
        else { setClipStartPositionMs(0); setClipEndPositionMs(duration) }
      }.build()
      val presentation = Presentation.createForWidthAndHeight(
        plan.width, plan.height,
        if (shot.fit == "cover") Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP else Presentation.LAYOUT_SCALE_TO_FIT,
      )
      val overlay = OverlayEffect(listOf(captionOverlay(shot.caption)))
      EditedMediaItem.Builder(media).setRemoveAudio(true)
        .apply { if (shot.input.kind == ProductionAssetKind.IMAGE) setFrameRate(plan.fps) }
        .setEffects(Effects(emptyList(), listOf(presentation, overlay))).build()
    }
  }

  private fun captionOverlay(value: String): TextOverlay {
    val text = SpannableString("  $value  ").apply {
      setSpan(ForegroundColorSpan(Color.WHITE), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(BackgroundColorSpan(Color.argb(190, 0, 48, 42)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      setSpan(AbsoluteSizeSpan(42), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    val settings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, -0.72f).setOverlayFrameAnchor(0f, 0f).build()
    return TextOverlay.createStaticTextOverlay(text, settings)
  }

  private fun durationSeconds(file: File): Double {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1_000.0
    } finally { retriever.release() }
  }
}
