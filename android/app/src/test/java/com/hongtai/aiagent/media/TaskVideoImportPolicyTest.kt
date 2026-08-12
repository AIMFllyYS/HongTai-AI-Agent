package com.hongtai.aiagent.media

import org.junit.Assert.assertThrows
import org.junit.Test

class TaskVideoImportPolicyTest {
  private val mp4Header = byteArrayOf(
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
  )

  @Test
  fun `accepts a bounded content mp4 with an ftyp box`() {
    TaskVideoImportPolicy.requireSupported(
      sourceScheme = "content",
      mimeType = "video/mp4",
      declaredBytes = 8L * 1024L * 1024L,
      header = mp4Header,
    )
  }

  @Test
  fun `rejects non content sources unsupported media and oversized files`() {
    assertThrows(IllegalArgumentException::class.java) {
      TaskVideoImportPolicy.requireSupported("file", "video/mp4", 10L, mp4Header)
    }
    assertThrows(IllegalArgumentException::class.java) {
      TaskVideoImportPolicy.requireSupported("content", "video/webm", 10L, mp4Header)
    }
    assertThrows(IllegalArgumentException::class.java) {
      TaskVideoImportPolicy.requireSupported("content", "video/mp4", TaskVideoImportPolicy.MAX_BYTES + 1L, mp4Header)
    }
  }

  @Test
  fun `rejects an empty file and a payload without an mp4 ftyp box`() {
    assertThrows(IllegalArgumentException::class.java) {
      TaskVideoImportPolicy.requireSupported("content", "video/mp4", 0L, mp4Header)
    }
    assertThrows(IllegalArgumentException::class.java) {
      TaskVideoImportPolicy.requireSupported("content", "video/mp4", 10L, byteArrayOf(0x00, 0x01, 0x02, 0x03))
    }
  }
}
