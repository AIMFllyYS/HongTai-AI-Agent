package com.hongtai.aiagent.production

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure-JVM coverage of the front-loaded sentence pipeline. Synthesis, duration measurement and
 * transcription are injected, so these tests exercise isolation, honest failure kinds and the
 * progress callback contract without Android media framework machinery.
 */
class NarrationSynthesisCoordinatorTest {
  private val directory = Files.createTempDirectory("hongtai-narration-coordinator").toFile()

  @After
  fun tearDown() {
    directory.deleteRecursively()
  }

  @Test
  fun `synthesizes every sentence, measures duration and reports per-sentence progress`() {
    val synthesized = mutableListOf<String>()
    val progress = mutableListOf<Triple<Int, Int, String>>()
    val audioOne = audioFile("one")
    val audioTwo = audioFile("two")

    val outcomes = coordinator(
      synthesize = { request ->
        synthesized += request.sentenceId
        if (request.sentenceId == "s-1") audioOne else audioTwo
      },
      measureDurationMs = { file -> if (file == audioOne) 3_200L else 4_100L },
      onSentenceFinished = { index, total, sentenceId -> progress += Triple(index, total, sentenceId) },
    ).run(listOf(sentence("s-1"), sentence("s-2")))

    assertEquals(listOf("s-1", "s-2"), synthesized)
    assertEquals(
      listOf(
        NarrationSentenceOutcome("s-1", 3_200L, "audio/narration-s-s-1.wav"),
        NarrationSentenceOutcome("s-2", 4_100L, "audio/narration-s-s-2.wav"),
      ),
      outcomes,
    )
    assertEquals(listOf(Triple(0, 2, "s-1"), Triple(1, 2, "s-2")), progress)
  }

  @Test
  fun `one sentence failing never aborts the remaining sentences`() {
    val outcomes = coordinator(
      synthesize = { request ->
        if (request.sentenceId == "s-2") throw ProductionException(ProductionFailureKind.TTS_SYNTHESIS_FAILED, "boom")
        audioFile(request.sentenceId)
      },
      measureDurationMs = { 1_000L },
    ).run(listOf(sentence("s-1"), sentence("s-2"), sentence("s-3")))

    assertEquals(ProductionFailureKind.TTS_SENTENCE_FAILED, outcomes[1].failure)
    assertNull(outcomes[1].durationMs)
    assertNull(outcomes[1].audioPath)
    assertEquals(1_000L, outcomes[0].durationMs)
    assertEquals(1_000L, outcomes[2].durationMs)
    assertNull(outcomes[0].failure)
    assertNull(outcomes[2].failure)
  }

  @Test
  fun `an unavailable engine keeps its job level kind instead of a sentence level one`() {
    val outcomes = coordinator(
      synthesize = { throw ProductionException(ProductionFailureKind.TTS_UNAVAILABLE, "no engine") },
      measureDurationMs = { 1_000L },
    ).run(listOf(sentence("s-1")))

    assertEquals(ProductionFailureKind.TTS_UNAVAILABLE, outcomes.single().failure)
  }

  @Test
  fun `audio whose duration cannot be read is failed without a fabricated duration`() {
    val outcomes = coordinator(
      synthesize = { audioFile("s-1") },
      measureDurationMs = { throw ProductionException(ProductionFailureKind.TTS_SENTENCE_FAILED, "unreadable") },
    ).run(listOf(sentence("s-1")))

    assertEquals(ProductionFailureKind.TTS_SENTENCE_FAILED, outcomes.single().failure)
    assertNull(outcomes.single().durationMs)
  }

  @Test
  fun `a transcription failure keeps the measured audio and marks only the timing source`() {
    val outcomes = coordinator(
      synthesize = { audioFile("s-1") },
      measureDurationMs = { 2_400L },
      transcribe = { throw ProductionException(ProductionFailureKind.TRANSCRIPTION_FAILED, "rejected") },
    ).run(listOf(sentence("s-1", needsTranscription = true)))

    assertEquals(ProductionFailureKind.TRANSCRIPTION_FAILED, outcomes.single().failure)
    assertEquals(2_400L, outcomes.single().durationMs)
    assertEquals("audio/narration-s-s-1.wav", outcomes.single().audioPath)
  }

  @Test
  fun `needing word timings without a transcription endpoint reports unavailable timing`() {
    val outcomes = coordinator(
      synthesize = { audioFile("s-1") },
      measureDurationMs = { 2_400L },
      transcribe = null,
    ).run(listOf(sentence("s-1", needsTranscription = true)))

    assertEquals(ProductionFailureKind.TTS_UNAVAILABLE, outcomes.single().failure)
    assertEquals(2_400L, outcomes.single().durationMs)
  }

  @Test
  fun `transcribed words travel with the outcome when the endpoint answers`() {
    val words = listOf(NarrationTranscribedWord("真实", 0, 480), NarrationTranscribedWord("服务", 480, 1_120))

    val outcomes = coordinator(
      synthesize = { audioFile("s-1") },
      measureDurationMs = { 1_400L },
      transcribe = { words },
    ).run(listOf(sentence("s-1", needsTranscription = true)))

    assertEquals(words, outcomes.single().transcribedWords)
    assertNull(outcomes.single().failure)
  }

  @Test
  fun `sentences past the overall timeout are failed instead of starting new work`() {
    var now = 0L
    var synthesized = 0

    val outcomes = NarrationSynthesisCoordinator(
      synthesize = { request ->
        synthesized += 1
        now += 1_000L
        audioFile(request.sentenceId)
      },
      measureDurationMs = { 1_000L },
      transcribe = null,
      onSentenceFinished = { _, _, _ -> },
      overallTimeoutMs = 1_500L,
      clock = { now },
    ).run(listOf(sentence("s-1"), sentence("s-2"), sentence("s-3"), sentence("s-4")))

    // Sentences 1–2 start inside the 1.5 s budget and succeed; sentences 3–4 start at or past
    // the deadline and are reported failed without consuming a synthesis attempt.
    assertEquals(2, synthesized)
    assertNull(outcomes[0].failure)
    assertNull(outcomes[1].failure)
    assertEquals(ProductionFailureKind.TTS_SENTENCE_FAILED, outcomes[2].failure)
    assertEquals(ProductionFailureKind.TTS_SENTENCE_FAILED, outcomes[3].failure)
    assertEquals(4, outcomes.size)
  }

  private fun sentence(id: String, needsTranscription: Boolean = false) = NarrationSentenceRequest(id, "文案 $id", needsTranscription)

  private fun coordinator(
    synthesize: (NarrationSentenceRequest) -> File,
    measureDurationMs: (File) -> Long,
    transcribe: ((File) -> List<NarrationTranscribedWord>)? = null,
    onSentenceFinished: (Int, Int, String) -> Unit = { _, _, _ -> },
  ) = NarrationSynthesisCoordinator(synthesize, measureDurationMs, transcribe, onSentenceFinished)

  private fun audioFile(name: String): File = File(directory, "$name.wav").apply { writeText(name) }
}
