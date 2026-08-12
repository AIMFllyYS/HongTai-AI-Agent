package com.hongtai.aiagent.production

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** An explicit port keeps Android's fallback voice separate from cloud TTS. */
internal interface NarrationSynthesizer {
  fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>>
}

/**
 * Both system and cloud synthesis write beside the final segment. Preserve an
 * already usable segment until the replacement is completely written, then
 * swap it within the same private directory. This mirrors final MP4 handling
 * so a retry cannot discard an earlier successful narration before the new
 * one exists.
 */
internal fun finalizeNarrationSegment(temporary: File, output: File) {
  val backup = File(output.parentFile, ".${output.nameWithoutExtension}.previous.wav")
  if (backup.exists() && !backup.delete()) {
    throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not clear a stale narration backup.")
  }
  var previousMoved = false
  try {
    if (output.exists()) {
      if (!output.renameTo(backup)) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not preserve a previous narration segment.")
      }
      previousMoved = true
    }
    if (!temporary.renameTo(output)) {
      throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not finalize a narration segment.")
    }
    if (backup.exists()) backup.delete()
  } catch (error: ProductionException) {
    if (previousMoved && !output.exists()) backup.renameTo(output)
    throw error
  }
}

internal class SystemNarrationSynthesizer(
  private val context: Context,
  private val store: ProductionMediaStore,
) : NarrationSynthesizer {
  override fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>> {
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

  /** Prefer an installed/offline voice without rejecting a functioning provider voice. */
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
    val temporary = File(output.parentFile, ".narration-${shot.order}.part.wav")
    if (temporary.exists() && !temporary.delete()) throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not replace a temporary TTS segment.")
    try {
      val finished = CountDownLatch(1)
      val failure = AtomicReference<String?>()
      val utteranceId = "production-$projectId-${shot.order}"
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) = Unit
        override fun onDone(id: String?) { if (id == utteranceId) finished.countDown() }
        @Deprecated("Deprecated in Java") override fun onError(id: String?) { if (id == utteranceId) { failure.set("TTS synthesis failed."); finished.countDown() } }
        override fun onError(id: String?, errorCode: Int) { if (id == utteranceId) { failure.set("TTS synthesis failed with code $errorCode."); finished.countDown() } }
      })
      if (engine.synthesizeToFile(shot.narration, Bundle(), temporary, utteranceId) != TextToSpeech.SUCCESS) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "Could not start system TTS synthesis.")
      }
      if (!finished.await(30, TimeUnit.SECONDS)) throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "System TTS synthesis timed out.")
      if (failure.get() != null || !temporary.isFile || temporary.length() <= 0L) {
        throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, failure.get() ?: "System TTS produced no audio.")
      }
      finalizeNarrationSegment(temporary, output)
      return output
    } finally {
      temporary.delete()
    }
  }
}
