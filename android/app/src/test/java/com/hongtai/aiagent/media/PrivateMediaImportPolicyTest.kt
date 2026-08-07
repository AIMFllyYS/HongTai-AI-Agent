package com.hongtai.aiagent.media

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
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

  @Test
  fun `resolves image MIME from provider then name then file signature`() {
    assertEquals(
      "image/png",
      PrivateMediaImportPolicy.imageMimeType("image/png", "ignored.jpg", byteArrayOf()),
    )
    assertEquals(
      "image/jpeg",
      PrivateMediaImportPolicy.imageMimeType(null, "舌象照片.JPEG", byteArrayOf()),
    )
    assertEquals(
      "image/png",
      PrivateMediaImportPolicy.imageMimeType(
        null,
        "没有扩展名",
        byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ),
    )
    assertEquals(
      "image/webp",
      PrivateMediaImportPolicy.imageMimeType(
        "application/octet-stream",
        "unknown.bin",
        "RIFF1234WEBP".toByteArray(Charsets.US_ASCII),
      ),
    )
    assertEquals(null, PrivateMediaImportPolicy.imageMimeType(null, "unknown.bin", byteArrayOf(1, 2, 3)))
  }

  @Test
  fun `publishes an imported file only after its bounded stream completes`() {
    val directory = Files.createTempDirectory("hongtai-private-media").toFile()
    val temporary = File(directory, ".photo.jpg.part")
    val destination = File(directory, "photo.jpg")
    val bytes = byteArrayOf(1, 2, 3, 4)

    try {
      val copied = PrivateMediaImportPolicy.copyBounded(
        input = ByteArrayInputStream(bytes),
        temporary = temporary,
        destination = destination,
        maxBytes = bytes.size.toLong(),
      )

      assertEquals(bytes.size.toLong(), copied)
      assertTrue(destination.isFile)
      assertTrue(destination.readBytes().contentEquals(bytes))
      assertFalse(temporary.exists())
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun `removes temporary import and does not publish when stream exceeds limit`() {
    val directory = Files.createTempDirectory("hongtai-private-media").toFile()
    val temporary = File(directory, ".oversized.jpg.part")
    val destination = File(directory, "oversized.jpg")

    try {
      assertThrows(IllegalStateException::class.java) {
        PrivateMediaImportPolicy.copyBounded(
          input = ByteArrayInputStream(ByteArray(9)),
          temporary = temporary,
          destination = destination,
          maxBytes = 8L,
        )
      }

      assertFalse(temporary.exists())
      assertFalse(destination.exists())
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun `removes temporary import and does not publish when source fails`() {
    val directory = Files.createTempDirectory("hongtai-private-media").toFile()
    val temporary = File(directory, ".broken.jpg.part")
    val destination = File(directory, "broken.jpg")
    val failingInput = object : InputStream() {
      private var readOnce = false

      override fun read(): Int = throw UnsupportedOperationException("Buffered reads are required.")

      override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (!readOnce) {
          readOnce = true
          buffer[offset] = 1
          return 1
        }
        throw IOException("The content provider disconnected.")
      }
    }

    try {
      assertThrows(IOException::class.java) {
        PrivateMediaImportPolicy.copyBounded(
          input = failingInput,
          temporary = temporary,
          destination = destination,
          maxBytes = 8L,
        )
      }

      assertFalse(temporary.exists())
      assertFalse(destination.exists())
    } finally {
      directory.deleteRecursively()
    }
  }
}
