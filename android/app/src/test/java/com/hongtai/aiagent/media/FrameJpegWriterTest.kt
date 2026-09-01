package com.hongtai.aiagent.media

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class FrameJpegWriterTest {
  private lateinit var root: File

  @Before
  fun setUp() {
    root = Files.createTempDirectory("frame-jpeg-writer-test").toFile()
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
  }

  @Test
  fun `a file with the JPEG magic header is accepted`() {
    val file = File(root, "frame.jpg").apply { writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0x01, 0x02)) }
    assertTrue(FrameJpegWriter.isJpeg(file))
  }

  @Test
  fun `truncated, foreign and missing files are rejected`() {
    val truncated = File(root, "short.jpg").apply { writeBytes(byteArrayOf(0xFF.toByte())) }
    val foreign = File(root, "png.bin").apply { writeBytes(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)) }
    val missing = File(root, "missing.jpg")

    assertFalse(FrameJpegWriter.isJpeg(truncated))
    assertFalse(FrameJpegWriter.isJpeg(foreign))
    assertFalse(FrameJpegWriter.isJpeg(missing))
  }
}
