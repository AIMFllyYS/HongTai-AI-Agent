package com.hongtai.aiagent.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivateMediaImportPolicyTest {
  @Test
  fun `accepts only system content uri sources`() {
    assertTrue(PrivateMediaImportPolicy.acceptsSourceScheme("content"))
    assertFalse(PrivateMediaImportPolicy.acceptsSourceScheme("file"))
    assertFalse(PrivateMediaImportPolicy.acceptsSourceScheme("https"))
    assertFalse(PrivateMediaImportPolicy.acceptsSourceScheme(null))
  }

  @Test
  fun `keeps Chinese media names while removing path characters`() {
    assertEquals(
      "舌象_观察 01.jpg",
      PrivateMediaImportPolicy.safeFileName("舌象/观察 01.jpg"),
    )
  }
}
