package com.hongtai.aiagent.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalFilesPolicyTest {
  @Test
  fun `keeps standalone task and observation artifacts beneath fixed private roots`() {
    assertEquals("report/report.json", LocalFilesPolicy.relativePath("report/report.json"))
    assertEquals("session-2026_08", LocalFilesPolicy.sessionId("session-2026_08"))
    assertEquals("production-2026_08", LocalFilesPolicy.projectId("production-2026_08"))
    assertEquals("template-2026_08", LocalFilesPolicy.templateId("template-2026_08"))
    assertEquals("inputs/asset-1.mp4", LocalFilesPolicy.productionDeletablePath("inputs/asset-1.mp4"))
    assertEquals("output.mp4", LocalFilesPolicy.productionDeletablePath("output.mp4"))
  }

  @Test
  fun `rejects traversal and invalid standalone session identifiers`() {
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.relativePath("../other/task.json")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.sessionId("../../other")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.projectId("../../other")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.templateId("../../other")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.productionDeletablePath("project.json")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LocalFilesPolicy.productionDeletablePath("inputs/../output.mp4")
    }
  }
}
