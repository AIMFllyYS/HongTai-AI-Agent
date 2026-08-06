package com.hongtai.aiagent.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalFilesPolicyTest {
  @Test
  fun `keeps standalone task and observation artifacts beneath fixed private roots`() {
    assertEquals("report/report.json", LocalFilesPolicy.relativePath("report/report.json"))
    assertEquals("session-2026_08", LocalFilesPolicy.sessionId("session-2026_08"))
  }

  @Test
  fun `rejects traversal and invalid standalone session identifiers`() {
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.relativePath("../other/task.json")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.sessionId("../../other")
    }
  }
}
