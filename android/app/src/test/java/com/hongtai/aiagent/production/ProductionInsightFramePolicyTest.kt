package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductionInsightFramePolicyTest {
  @Test
  fun `never samples the very first or very last frame of a clip`() {
    val samples = ProductionInsightFramePolicy.sampleMillis(10_000L)

    assertEquals(listOf(1_000L, 5_000L, 8_500L), samples)
    assertTrue("openings fade in from black", samples.first() > 0L)
    assertTrue("endings cut to black", samples.last() < 10_000L - 1L)
  }

  @Test
  fun `short clips get fewer samples instead of three views of the same instant`() {
    assertEquals(listOf(500L), ProductionInsightFramePolicy.sampleMillis(1_000L))
    assertEquals(listOf(750L, 2_250L), ProductionInsightFramePolicy.sampleMillis(3_000L))
    assertEquals(3, ProductionInsightFramePolicy.sampleMillis(4_000L).size)
  }

  @Test
  fun `an unknown or zero duration still yields one readable position`() {
    assertEquals(listOf(0L), ProductionInsightFramePolicy.sampleMillis(0L))
    assertEquals(listOf(0L), ProductionInsightFramePolicy.sampleMillis(-1L))
    // A one millisecond clip has no interior frame to prefer, so the single position must stay in range.
    assertEquals(listOf(0L), ProductionInsightFramePolicy.sampleMillis(1L))
  }

  @Test
  fun `every sample stays inside the clip and never repeats`() {
    for (durationMs in longArrayOf(1L, 2L, 17L, 999L, 1_500L, 3_999L, 4_000L, 60_000L, 20L * 60L * 1_000L)) {
      val samples = ProductionInsightFramePolicy.sampleMillis(durationMs)
      assertTrue("at least one position for ${durationMs}ms", samples.isNotEmpty())
      assertTrue("no more than the contract's frame budget", samples.size <= ProductionInsightFramePolicy.MAX_FRAMES)
      assertEquals("positions must be distinct", samples.distinct().size, samples.size)
      assertEquals("positions must be in playback order", samples.sorted(), samples)
      samples.forEach { millis ->
        assertTrue("$millis is inside ${durationMs}ms", millis >= 0L && millis < maxOf(1L, durationMs))
      }
    }
  }

  @Test
  fun `frame files are recognised per asset so a re-run replaces only its own derivatives`() {
    val name = ProductionInsightFramePolicy.frameFileName("asset-1", 2)

    assertEquals("asset-1-2.jpg", name)
    assertTrue(ProductionInsightFramePolicy.isFrameFileOf("asset-1", name))
    assertFalse(ProductionInsightFramePolicy.isFrameFileOf("asset-2", name))
    assertFalse("an imported asset must never be mistaken for a derivative", ProductionInsightFramePolicy.isFrameFileOf("asset-1", "asset-1.jpg"))
    // Ids are opaque, so one can be a prefix of another. Clearing `asset-1` must not take out the
    // frames belonging to `asset-10`.
    assertFalse(ProductionInsightFramePolicy.isFrameFileOf("asset-1", ProductionInsightFramePolicy.frameFileName("asset-10", 0)))
    assertFalse(ProductionInsightFramePolicy.isFrameFileOf("asset-1", "asset-1-9.jpg"))
    assertFalse(ProductionInsightFramePolicy.isFrameFileOf("asset-1", "asset-1-0.png"))
  }

  @Test
  fun `the derivative budget stays under the AI attachment limit`() {
    // NativeAiRequestClient refuses attachments over 15 MiB; a frame at this budget must be sendable.
    assertEquals(15L * 1024L * 1024L, ProductionInsightFramePolicy.MAX_FRAME_BYTES)
    assertEquals(2_048, ProductionInsightFramePolicy.MAX_EDGE_PIXELS)
    assertEquals(3, ProductionInsightFramePolicy.MAX_FRAMES)
  }
}
