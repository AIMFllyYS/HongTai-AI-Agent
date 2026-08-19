package com.hongtai.aiagent.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ActiveWorkScreenStayCounterTest {
  @Test
  fun `keeps the screen on until the last overlapping job finishes`() {
    val counter = ActiveWorkScreenStayCounter()
    assertEquals(ActiveWorkScreenStayAction.KEEP_ON, counter.acquire())
    assertEquals(ActiveWorkScreenStayAction.NONE, counter.acquire())
    assertEquals(2, counter.holds())
    assertEquals(ActiveWorkScreenStayAction.NONE, counter.release())
    assertEquals(1, counter.holds())
    assertEquals(ActiveWorkScreenStayAction.ALLOW_OFF, counter.release())
    assertEquals(0, counter.holds())
  }

  @Test
  fun `rejects a release that does not match an acquire`() {
    val counter = ActiveWorkScreenStayCounter()
    assertThrows(IllegalStateException::class.java) { counter.release() }
  }
}
