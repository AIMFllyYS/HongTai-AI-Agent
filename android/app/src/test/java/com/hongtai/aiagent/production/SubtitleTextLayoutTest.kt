package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pins the same expectations as `tests/subtitle-template.test.ts` and
 * `apps/web/src/features/production/subtitle-preview-model.test.ts`. Line breaking and emphasis
 * segmentation exist in both languages, so a change on one side has to fail here to stay honest:
 * the preview would otherwise promise a layout the burned-in caption does not produce.
 */
class SubtitleTextLayoutTest {
  private val classicLineMaxChars = 14

  @Test
  fun `breaks lines on punctuation and never truncates an overlong caption`() {
    assertEquals(
      listOf("开场三秒先说结论，", "别绕弯子再进入正题"),
      SubtitleTextLayout.splitLines("开场三秒先说结论，别绕弯子再进入正题", classicLineMaxChars),
    )
    assertEquals(
      listOf("啊".repeat(14), "啊".repeat(6)),
      SubtitleTextLayout.splitLines("啊".repeat(20), classicLineMaxChars),
    )
    assertEquals(emptyList<String>(), SubtitleTextLayout.splitLines("   ", classicLineMaxChars))
    assertEquals(listOf("短句"), SubtitleTextLayout.splitLines("短句", classicLineMaxChars))
    assertEquals(4, SubtitleTextLayout.splitLines("啊".repeat(50), classicLineMaxChars).size)
  }

  @Test
  fun `collapses whitespace and keeps a break opportunity out of the first half of a line`() {
    assertEquals(listOf("先看环境 再看过程"), SubtitleTextLayout.splitLines("先看环境\n\n  再看过程", classicLineMaxChars))
    // The comma sits at index 2, inside the first half, so the line fills to the character budget.
    assertEquals(
      listOf("先看，环境真实到位这", "句还没有说完"),
      SubtitleTextLayout.splitLines("先看，环境真实到位这句还没有说完", 10),
    )
  }

  @Test
  fun `marks the longest emphasis match and leaves plain text untouched`() {
    assertEquals(
      listOf(
        SubtitleSegment("先看", false),
        SubtitleSegment("真实环境", true),
        SubtitleSegment("再看过程", false),
      ),
      SubtitleTextLayout.splitEmphasis("先看真实环境再看过程", listOf("真实", "真实环境")),
    )
    assertEquals(
      listOf(SubtitleSegment("完全没有关键词", false)),
      SubtitleTextLayout.splitEmphasis("完全没有关键词", listOf("  ")),
    )
  }

  @Test
  fun `sweeps line progress in reading order across every line`() {
    val lines = listOf("四个字啊", "六个字啊啊啊")
    assertEquals(1f, SubtitleTextLayout.lineProgress(lines, 0, 0.4f), 0.001f)
    assertEquals(0f, SubtitleTextLayout.lineProgress(lines, 1, 0.4f), 0.001f)
    assertEquals(0.5f, SubtitleTextLayout.lineProgress(lines, 1, 0.7f), 0.001f)
    assertEquals(0f, SubtitleTextLayout.lineProgress(emptyList(), 0, 1f), 0.001f)
  }
}
