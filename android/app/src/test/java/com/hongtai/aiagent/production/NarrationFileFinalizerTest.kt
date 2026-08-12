package com.hongtai.aiagent.production

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NarrationFileFinalizerTest {
  @Test
  fun `a missing replacement restores the previous narration`() {
    val directory = Files.createTempDirectory("hongtai-narration-finalizer").toFile()
    try {
      val output = File(directory, "narration-1.wav").apply { writeText("previous") }
      val missingTemporary = File(directory, ".narration-1.part.wav")

      try {
        finalizeNarrationSegment(missingTemporary, output)
      } catch (_: ProductionException) {
        // Expected: the failed replacement must leave the previous segment readable.
      }

      assertEquals("previous", output.readText())
      assertFalse(File(directory, ".narration-1.previous.wav").exists())
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun `a completed replacement supersedes the previous narration and removes its backup`() {
    val directory = Files.createTempDirectory("hongtai-narration-finalizer").toFile()
    try {
      val output = File(directory, "narration-1.wav").apply { writeText("previous") }
      val temporary = File(directory, ".narration-1.part.wav").apply { writeText("replacement") }

      finalizeNarrationSegment(temporary, output)

      assertEquals("replacement", output.readText())
      assertFalse(temporary.exists())
      assertFalse(File(directory, ".narration-1.previous.wav").exists())
    } finally {
      directory.deleteRecursively()
    }
  }
}
