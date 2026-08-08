package com.hongtai.aiagent.media

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoCapturePolicyTest {
  @Test
  fun `generated capture name is a private jpg leaf name`() {
    val name = PhotoCapturePolicy.fileNameFor("c5f8e1c4-5d0b-41c0-a7f5-4b5dfe07d1ef")

    assertTrue(name.startsWith("capture-"))
    assertTrue(name.endsWith(".jpg"))
    assertFalse(name.contains('/'))
    assertFalse(name.contains('\\'))
  }

  @Test(expected = IllegalArgumentException::class)
  fun `capture name refuses a path shaped identifier`() {
    PhotoCapturePolicy.fileNameFor("../not-a-capture")
  }
}
