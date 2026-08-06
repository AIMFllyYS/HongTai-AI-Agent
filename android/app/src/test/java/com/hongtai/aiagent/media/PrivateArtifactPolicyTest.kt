package com.hongtai.aiagent.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PrivateArtifactPolicyTest {
  @Test
  fun `keeps a task artifact path inside its private task root`() {
    assertEquals(
      "media/source-video.mp4",
      PrivateArtifactPolicy.normalizeRelativePath("media/source-video.mp4"),
    )
    assertEquals("task_2026-08-07", PrivateArtifactPolicy.taskDirectoryName("task_2026-08-07"))
  }

  @Test
  fun `rejects traversal and arbitrary task identifiers`() {
    assertThrows(IllegalArgumentException::class.java) {
      PrivateArtifactPolicy.normalizeRelativePath("../database/hongtai_localSQLite.db")
    }
    assertThrows(IllegalArgumentException::class.java) {
      PrivateArtifactPolicy.taskDirectoryName("../../other")
    }
  }

  @Test
  fun `rejects a short declared download before private artifact finalization`() {
    PrivateArtifactWritePolicy.requireExpectedLength(expectedBytes = 8L, actualBytes = 8L)

    assertThrows(PrivateArtifactLengthMismatchException::class.java) {
      PrivateArtifactWritePolicy.requireExpectedLength(expectedBytes = 8L, actualBytes = 7L)
    }
  }
}
