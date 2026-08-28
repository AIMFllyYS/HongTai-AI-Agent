package com.hongtai.aiagent.production

import android.media.MediaMetadataRetriever
import java.io.File

/** One sentence of the front-loaded narration stage: text to speak plus optional word alignment. */
internal data class NarrationSentenceRequest(
  val sentenceId: String,
  val speechText: String,
  val needsTranscription: Boolean,
)

/** Word timing from the transcription endpoint, in milliseconds relative to the sentence audio. */
internal data class NarrationTranscribedWord(
  val word: String,
  val startMs: Long,
  val endMs: Long,
)

/**
 * Per-sentence outcome. A sentence whose audio exists keeps durationMs/audioPath even when
 * transcription failed, so the shared layer can still time captions from the measured duration;
 * a sentence whose synthesis failed carries only the failure kind, never a fabricated duration.
 */
internal data class NarrationSentenceOutcome(
  val sentenceId: String,
  val durationMs: Long? = null,
  val audioPath: String? = null,
  val transcribedWords: List<NarrationTranscribedWord>? = null,
  val failure: ProductionFailureKind? = null,
)

/** Bridge-facing naming for front-loaded sentence audio inside one project's private directory. */
internal object NarrationSentenceAssets {
  const val FILE_PREFIX = "narration-s-"
  val SENTENCE_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")

  fun baseName(sentenceId: String): String = "$FILE_PREFIX$sentenceId"

  fun fileName(sentenceId: String): String = "${baseName(sentenceId)}.wav"

  /** Relative to the project private directory; consumed back by the renderer's narration assets. */
  fun relativePath(sentenceId: String): String = "audio/${fileName(sentenceId)}"
}

/** Bounds the whole front-loaded job; each sentence is already bounded by its own HTTP/latch timeout. */
internal object NarrationSynthesisTimeoutPolicy {
  const val OVERALL_TIMEOUT_MS = 900_000L
}

/** Measured sentence duration. The v4 plan's shot timing is derived from exactly this value. */
internal object NarrationAudioDurationProbe {
  fun measureMs(file: File): Long {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      val milliseconds = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
      if (milliseconds == null || milliseconds <= 0L) {
        throw ProductionException(ProductionFailureKind.TTS_SENTENCE_FAILED, "The narration audio duration is unavailable.")
      }
      milliseconds
    } catch (error: ProductionException) {
      throw error
    } catch (error: Exception) {
      throw ProductionException(ProductionFailureKind.TTS_SENTENCE_FAILED, "The narration audio duration could not be read.", error)
    } finally {
      retriever.release()
    }
  }
}

/**
 * Front-loaded per-sentence narration synthesis. A single sentence failure never aborts the job:
 * the remaining sentences continue and each outcome carries its own stable failure kind, so the
 * shared layer can retry exactly the sentences that failed without touching the ones that exist.
 */
internal class NarrationSynthesisCoordinator(
  private val synthesize: (NarrationSentenceRequest) -> File,
  private val measureDurationMs: (File) -> Long,
  private val transcribe: ((File) -> List<NarrationTranscribedWord>)?,
  private val onSentenceFinished: (index: Int, total: Int, sentenceId: String) -> Unit,
  private val overallTimeoutMs: Long = NarrationSynthesisTimeoutPolicy.OVERALL_TIMEOUT_MS,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  fun run(requests: List<NarrationSentenceRequest>): List<NarrationSentenceOutcome> {
    val startedAtMs = clock()
    return requests.mapIndexed { index, request ->
      val outcome = if (clock() - startedAtMs >= overallTimeoutMs) {
        // Watchdog budget exhausted before this sentence starts: report it failed instead of
        // starting new work the caller may already have given up on.
        NarrationSentenceOutcome(request.sentenceId, failure = ProductionFailureKind.TTS_SENTENCE_FAILED)
      } else {
        synthesizeOne(request)
      }
      onSentenceFinished(index, requests.size, request.sentenceId)
      outcome
    }
  }

  private fun synthesizeOne(request: NarrationSentenceRequest): NarrationSentenceOutcome {
    val audio = try {
      synthesize(request)
    } catch (error: ProductionException) {
      val kind = if (error.kind == ProductionFailureKind.TTS_UNAVAILABLE) error.kind else ProductionFailureKind.TTS_SENTENCE_FAILED
      return NarrationSentenceOutcome(request.sentenceId, failure = kind)
    } catch (_: Exception) {
      return NarrationSentenceOutcome(request.sentenceId, failure = ProductionFailureKind.TTS_SENTENCE_FAILED)
    }
    val durationMs = try {
      measureDurationMs(audio)
    } catch (_: Exception) {
      // The audio file exists on disk but its duration is unreadable, so it cannot drive v4
      // timing. Keep the segment; a retry overwrites it through finalizeNarrationSegment.
      return NarrationSentenceOutcome(request.sentenceId, failure = ProductionFailureKind.TTS_SENTENCE_FAILED)
    }
    if (!request.needsTranscription) {
      return NarrationSentenceOutcome(request.sentenceId, durationMs, NarrationSentenceAssets.relativePath(request.sentenceId))
    }
    val transcriber = transcribe ?: return NarrationSentenceOutcome(
      request.sentenceId,
      durationMs,
      NarrationSentenceAssets.relativePath(request.sentenceId),
      failure = ProductionFailureKind.TTS_UNAVAILABLE,
    )
    val words = try {
      transcriber(audio)
    } catch (error: ProductionException) {
      val kind = if (error.kind == ProductionFailureKind.TTS_UNAVAILABLE) error.kind else ProductionFailureKind.TRANSCRIPTION_FAILED
      return NarrationSentenceOutcome(
        request.sentenceId,
        durationMs,
        NarrationSentenceAssets.relativePath(request.sentenceId),
        failure = kind,
      )
    } catch (_: Exception) {
      return NarrationSentenceOutcome(
        request.sentenceId,
        durationMs,
        NarrationSentenceAssets.relativePath(request.sentenceId),
        failure = ProductionFailureKind.TRANSCRIPTION_FAILED,
      )
    }
    return NarrationSentenceOutcome(
      request.sentenceId,
      durationMs,
      NarrationSentenceAssets.relativePath(request.sentenceId),
      words,
    )
  }
}
