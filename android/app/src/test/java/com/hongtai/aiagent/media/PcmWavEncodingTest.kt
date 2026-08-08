package com.hongtai.aiagent.media

import android.media.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmWavEncodingTest {
  @Test
  fun `allows only private media roots as decoder inputs`() {
    assertEquals(true, PrivateMediaDecodePolicy.acceptsRelativeInputPath("media/imports/camera.jpg"))
    assertEquals(true, PrivateMediaDecodePolicy.acceptsRelativeInputPath("media/pcm/decoded.wav"))
    assertEquals(true, PrivateMediaDecodePolicy.acceptsRelativeInputPath("tasks/task-1/media/video.mp4"))
    assertEquals(false, PrivateMediaDecodePolicy.acceptsRelativeInputPath("databases/hongtai-local.db"))
    assertEquals(false, PrivateMediaDecodePolicy.acceptsRelativeInputPath("tasks/task-1/state/secret.json"))
  }

  @Test
  fun `converts unsigned 8 bit decoder output to signed 16 bit little endian`() {
    val format = PcmWavFormat(
      sampleRateHz = 16_000,
      channelCount = 1,
      sourceEncoding = AudioFormat.ENCODING_PCM_8BIT,
    )

    assertArrayEquals(
      byteArrayOf(0x00, 0x80.toByte(), 0x00, 0x00, 0x00, 0x7f),
      PcmWavEncoding.toSigned16LittleEndian(byteArrayOf(0x00, 0x80.toByte(), 0xff.toByte()), format),
    )
  }

  @Test
  fun `converts float decoder output and clamps non finite samples`() {
    val source = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
      .putFloat(-1f)
      .putFloat(0f)
      .putFloat(1f)
      .putFloat(Float.NaN)
      .array()
    val format = PcmWavFormat(
      sampleRateHz = 16_000,
      channelCount = 1,
      sourceEncoding = AudioFormat.ENCODING_PCM_FLOAT,
    )

    val converted = ByteBuffer.wrap(PcmWavEncoding.toSigned16LittleEndian(source, format))
      .order(ByteOrder.LITTLE_ENDIAN)

    assertEquals(-32_767, converted.short.toInt())
    assertEquals(0, converted.short.toInt())
    assertEquals(32_767, converted.short.toInt())
    assertEquals(0, converted.short.toInt())
  }

  @Test
  fun `writes a canonical pcm wav header`() {
    val format = PcmWavFormat(
      sampleRateHz = 16_000,
      channelCount = 1,
      sourceEncoding = AudioFormat.ENCODING_PCM_16BIT,
    )

    val header = ByteBuffer.wrap(PcmWavEncoding.header(format, 320)).order(ByteOrder.LITTLE_ENDIAN)
    val riff = ByteArray(4).also(header::get)
    val fileSize = header.int
    val wave = ByteArray(4).also(header::get)
    header.position(20)
    val audioFormat = header.short
    val channels = header.short
    val sampleRate = header.int
    val byteRate = header.int
    val blockAlign = header.short
    val bitsPerSample = header.short
    val data = ByteArray(4).also(header::get)
    val dataSize = header.int

    assertArrayEquals("RIFF".toByteArray(), riff)
    assertEquals(356, fileSize)
    assertArrayEquals("WAVE".toByteArray(), wave)
    assertEquals(1, audioFormat.toInt())
    assertEquals(1, channels.toInt())
    assertEquals(16_000, sampleRate)
    assertEquals(32_000, byteRate)
    assertEquals(2, blockAlign.toInt())
    assertEquals(16, bitsPerSample.toInt())
    assertArrayEquals("data".toByteArray(), data)
    assertEquals(320, dataSize)
  }
}
