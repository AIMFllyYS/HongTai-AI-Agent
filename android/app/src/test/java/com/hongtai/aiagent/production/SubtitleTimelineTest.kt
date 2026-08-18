package com.hongtai.aiagent.production

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleTimelineTest {
  @Test
  fun `holds no caption before the first cue and between cues`() {
    val template = template()
    val cues = listOf(cue(0L, 1_500L, "先看真实环境"), cue(2_000L, 3_500L, "再看服务过程"))

    assertNull(SubtitleTimeline.frameAt(cues, template, 1_500L))
    assertNull(SubtitleTimeline.frameAt(cues, template, 1_999L))
    assertEquals(0, SubtitleTimeline.frameAt(cues, template, 0L)!!.cueIndex)
    assertEquals(1, SubtitleTimeline.frameAt(cues, template, 2_000L)!!.cueIndex)
    assertNull(SubtitleTimeline.frameAt(cues, template, 3_500L))
  }

  @Test
  fun `settles the entrance after its duration and keeps a static template at rest`() {
    val sliding = template(entranceKind = "slide_up", entranceDurationMs = 400)
    val cues = listOf(cue(0L, 2_000L, "先看真实环境"))

    assertEquals(0f, SubtitleTimeline.frameAt(cues, sliding, 0L)!!.entranceProgress, 0.001f)
    assertEquals(1f, SubtitleTimeline.frameAt(cues, sliding, 400L)!!.entranceProgress, 0.001f)
    assertEquals(1f, SubtitleTimeline.frameAt(cues, sliding, 1_800L)!!.entranceProgress, 0.001f)
    assertEquals(1f, SubtitleTimeline.frameAt(cues, template(), 0L)!!.entranceProgress, 0.001f)
  }

  @Test
  fun `sweeps the karaoke reveal by word timing instead of by clock share`() {
    val karaoke = template(wordReveal = "karaoke", pendingHex = "#8fb3ab")
    val words = listOf(
      SubtitleCueWord("先看", 0L, 200L),
      SubtitleCueWord("真实环境", 1_600L, 2_000L),
    )
    val cues = listOf(cue(0L, 2_000L, "先看真实环境", words = words))

    // Half the cue has elapsed, but only the first two characters were spoken.
    val middle = SubtitleTimeline.frameAt(cues, karaoke, 1_000L)!!
    assertEquals(2, middle.revealedChars(6))
    assertEquals(6, SubtitleTimeline.frameAt(cues, karaoke, 1_999L)!!.revealedChars(6))
    assertEquals(1f, SubtitleTimeline.frameAt(cues, template(), 1_000L)!!.revealProgress, 0.001f)
  }

  @Test
  fun `falls back to clock share only when a cue carries no word timing`() {
    val karaoke = template(wordReveal = "karaoke", pendingHex = "#8fb3ab")
    val cues = listOf(cue(0L, 2_000L, "先看真实环境"))

    assertEquals(3, SubtitleTimeline.frameAt(cues, karaoke, 1_000L)!!.revealedChars(6))
  }

  @Test
  fun `reuses one bitmap while the visible pixels are unchanged`() {
    val karaoke = template(wordReveal = "karaoke", pendingHex = "#8fb3ab")
    val words = listOf(SubtitleCueWord("先看真实环境", 0L, 2_000L))
    val cues = listOf(cue(0L, 2_000L, "先看真实环境", words = words))

    val first = SubtitleTimeline.frameAt(cues, karaoke, 1_000L)!!.bitmapKey(6)
    val sameCharacter = SubtitleTimeline.frameAt(cues, karaoke, 1_040L)!!.bitmapKey(6)
    val nextCharacter = SubtitleTimeline.frameAt(cues, karaoke, 1_400L)!!.bitmapKey(6)

    assertEquals(first, sameCharacter)
    assertNotEquals(first, nextCharacter)
  }

  @Test
  fun `treats the first frame it sees as the item start`() {
    val clock = SubtitleOverlayClock(itemStartMs = 0L)

    assertEquals(0L, clock.relativeMs(4_000_000L))
    assertEquals(500L, clock.relativeMs(4_500_000L))

    val repeated = SubtitleOverlayClock(itemStartMs = 3_000L)
    assertEquals(3_000L, repeated.relativeMs(9_000_000L))
    assertEquals(3_250L, repeated.relativeMs(9_250_000L))
  }

  @Test
  fun `eases within bounds and lets overshoot pass its target before settling`() {
    assertEquals(0f, SubtitleTimeline.ease("standard", 0f), 0.001f)
    assertEquals(1f, SubtitleTimeline.ease("standard", 1f), 0.001f)
    assertEquals(0.5f, SubtitleTimeline.ease("linear", 0.5f), 0.001f)
    assertTrue(SubtitleTimeline.ease("standard", 0.5f) > 0.5f)
    assertTrue(SubtitleTimeline.ease("overshoot", 0.75f) > 1f)
    assertEquals(0.5f, SubtitleTimeline.ease("unknown_easing", 0.5f), 0.001f)
  }

  @Test
  fun `rejects a template the renderer cannot execute`() {
    assertThrows(IllegalArgumentException::class.java) { template(wordReveal = "karaoke") }
    assertThrows(IllegalArgumentException::class.java) { template(fontSizePx = 12.0) }
    assertThrows(IllegalArgumentException::class.java) { template(bottomOffsetPx = 40.0) }
    assertThrows(IllegalArgumentException::class.java) { template(fillHex = "#FFFFFF") }
    assertThrows(IllegalArgumentException::class.java) { template(entranceKind = "spin") }
  }

  private fun cue(
    startMs: Long,
    endMs: Long,
    text: String,
    emphasisWords: List<String> = emptyList(),
    words: List<SubtitleCueWord>? = null,
  ) = SubtitleCue(startMs, endMs, text, emphasisWords, words)

  private fun template(
    wordReveal: String = "none",
    pendingHex: String? = null,
    entranceKind: String = "none",
    entranceDurationMs: Int = 0,
    fontSizePx: Double = 46.0,
    bottomOffsetPx: Double = 260.0,
    fillHex: String = "#ffffff",
  ): SubtitleTemplateSpec = SubtitleRenderSpecParser.parseTemplate(
    JSONObject(
      """
      {
        "id":"classic_line",
        "typography":{"fontSizePx":$fontSizePx,"lineHeight":1.25,"fontWeight":700,"letterSpacingPx":0.5,"maxLines":2,"maxCharsPerLine":14},
        "layout":{"align":"center","bottomOffsetPx":$bottomOffsetPx,"insetPx":48},
        "fill":{"hex":"$fillHex","opacity":1},
        "stroke":{"color":{"hex":"#001815","opacity":0.9},"widthPx":6},
        "box":null,
        "entrance":{"kind":"$entranceKind","durationMs":$entranceDurationMs,"easing":"standard","travelPx":24},
        "wordReveal":"$wordReveal",
        "pendingFill":${pendingHex?.let { "{\"hex\":\"$it\",\"opacity\":0.75}" } ?: "null"},
        "emphasis":{"kind":"none","color":null,"peakScale":1,"durationMs":0,"easing":"standard"}
      }
      """.trimIndent(),
    ),
  )
}
