package com.hongtai.aiagent.media

import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageFormatProbeTest {
  @Test
  fun `recognizes ordinary image formats from complete magic bytes`() {
    assertEquals(ImageFormat.JPEG, probe(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0x00)))
    assertEquals(ImageFormat.PNG, probe(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
    assertEquals(ImageFormat.WEBP, probe("RIFF\u0010\u0000\u0000\u0000WEBP".toByteArray(Charsets.ISO_8859_1)))
  }

  @Test
  fun `recognizes HEVC HEIF ftyp brands including extended size`() {
    assertEquals(ImageFormat.HEIF_CANDIDATE, probe(ftyp("heic", "mif1")))
    assertEquals(ImageFormat.HEIF_CANDIDATE, probe(ftyp("mif1", "hevc", extended = true)))
  }

  @Test
  fun `rejects AVIF malformed truncated overflowing and zero sized boxes`() {
    assertEquals(ImageFormat.UNSUPPORTED, probe(ftyp("avif", "mif1")))
    assertEquals(ImageFormat.UNSUPPORTED, probe(byteArrayOf(0, 0, 0, 16) + "ftyp".toByteArray() + "heic".toByteArray()))
    assertEquals(
      ImageFormat.UNSUPPORTED,
      probe(byteArrayOf(0, 0, 0, 1) + "ftyp".toByteArray() + ByteArray(8) { 0xff.toByte() }),
    )
    assertEquals(ImageFormat.UNSUPPORTED, probe(ByteArray(8).also { "free".toByteArray().copyInto(it, 4) }))
  }

  @Test
  fun `provider metadata cannot upgrade unknown bytes and cannot hide HEIF bytes`() {
    assertEquals(
      ImageFormat.UNSUPPORTED,
      ImageFormatProbe.probe(ByteArrayInputStream("not an image".toByteArray()), 12),
    )
    assertEquals(
      ImageFormat.HEIF_CANDIDATE,
      ImageFormatProbe.probe(ByteArrayInputStream(ftyp("heic")), ftyp("heic").size.toLong()),
    )
  }

  @Test
  fun `reads at most the probe budget even when partial reads are used`() {
    val bytes = ByteArray(ImageFormatProbe.MAX_PROBE_BYTES + 1_024)
    val input = CountingPartialInputStream(bytes, 3)

    assertEquals(ImageFormat.UNSUPPORTED, ImageFormatProbe.probe(input, bytes.size.toLong()))
    assertTrue(input.bytesRead <= ImageFormatProbe.MAX_PROBE_BYTES)
  }

  @Test
  fun `inspects no more than sixty four top level boxes`() {
    val boxes = buildList {
      repeat(ImageFormatProbe.MAX_TOP_LEVEL_BOXES) { add(box("free", ByteArray(0))) }
      add(ftyp("heic"))
    }.fold(ByteArray(0), ByteArray::plus)

    assertEquals(ImageFormat.UNSUPPORTED, probe(boxes))
  }

  private fun probe(bytes: ByteArray): ImageFormat =
    ImageFormatProbe.probe(ByteArrayInputStream(bytes), bytes.size.toLong())

  private fun ftyp(major: String, vararg compatible: String, extended: Boolean = false): ByteArray {
    val payload = major.toByteArray() + ByteArray(4) + compatible.fold(ByteArray(0)) { all, brand -> all + brand.toByteArray() }
    if (!extended) return box("ftyp", payload)
    val size = 16L + payload.size
    return byteArrayOf(0, 0, 0, 1) + "ftyp".toByteArray() + longBytes(size) + payload
  }

  private fun box(type: String, payload: ByteArray): ByteArray {
    val size = 8 + payload.size
    return byteArrayOf(
      (size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte(),
    ) + type.toByteArray() + payload
  }

  private fun longBytes(value: Long): ByteArray = ByteArray(8) { index ->
    (value ushr ((7 - index) * 8)).toByte()
  }

  private class CountingPartialInputStream(
    bytes: ByteArray,
    private val chunk: Int,
  ) : InputStream() {
    private val delegate = ByteArrayInputStream(bytes)
    var bytesRead = 0
      private set

    override fun read(): Int = delegate.read().also { if (it >= 0) bytesRead++ }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
      delegate.read(buffer, offset, minOf(length, chunk)).also { if (it > 0) bytesRead += it }
  }
}
