package com.hongtai.aiagent.media

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ObservationImageDecoderSelectorTest {
  private val source = File("synthetic-source")

  @Test
  fun `API 24 and 25 route confirmed HEIF to native exactly once`() {
    listOf(24, 25).forEach { sdk ->
      val platform = FakeDecoder("platform")
      val legacy = FakeDecoder("legacy", orientationApplied = true)

      val result = selector(platform, legacy).decode(sdk, ImageFormat.HEIF_CANDIDATE, source)

      assertEquals("legacy", result.value)
      assertTrue(result.orientationApplied)
      assertEquals(0, platform.calls)
      assertEquals(1, legacy.calls)
    }
  }

  @Test
  fun `API 26 and newer route confirmed HEIF to platform exactly once`() {
    val platform = FakeDecoder("platform")
    val legacy = FakeDecoder("legacy")

    val result = selector(platform, legacy).decode(26, ImageFormat.HEIF_CANDIDATE, source)

    assertEquals("platform", result.value)
    assertEquals(1, platform.calls)
    assertEquals(0, legacy.calls)
  }

  @Test
  fun `ordinary images always use the platform decoder`() {
    listOf(ImageFormat.JPEG, ImageFormat.PNG, ImageFormat.WEBP).forEach { format ->
      val platform = FakeDecoder("platform")
      val legacy = FakeDecoder("legacy")

      selector(platform, legacy).decode(24, format, source)

      assertEquals(1, platform.calls)
      assertEquals(0, legacy.calls)
    }
  }

  @Test
  fun `unsupported bytes never reach either decoder`() {
    val platform = FakeDecoder("platform")
    val legacy = FakeDecoder("legacy")

    assertThrows(PrivateImageInvalidException::class.java) {
      selector(platform, legacy).decode(24, ImageFormat.UNSUPPORTED, source)
    }
    assertEquals(0, platform.calls)
    assertEquals(0, legacy.calls)
  }

  @Test
  fun `already oriented native results skip the common EXIF transform`() {
    val result = selector(FakeDecoder("platform"), FakeDecoder("legacy", true))
      .decode(24, ImageFormat.HEIF_CANDIDATE, source)

    assertFalse(ObservationImageTransformPolicy.shouldApplyExif(result))
  }

  @Test
  fun `native failures map to stable private import exceptions`() {
    assertThrows(PrivateMediaTooLargeException::class.java) {
      failingSelector(LegacyHeifFailure.TOO_LARGE).decode(24, ImageFormat.HEIF_CANDIDATE, source)
    }
    listOf(LegacyHeifFailure.INVALID, LegacyHeifFailure.ALLOCATION_FAILED).forEach { failure ->
      assertThrows(PrivateImageInvalidException::class.java) {
        failingSelector(failure).decode(24, ImageFormat.HEIF_CANDIDATE, source)
      }
    }
    assertThrows(PrivateMediaReadException::class.java) {
      failingSelector(LegacyHeifFailure.UNAVAILABLE).decode(24, ImageFormat.HEIF_CANDIDATE, source)
    }
  }

  @Test
  fun `linkage and allocation errors become stable terminal exceptions`() {
    assertThrows(PrivateMediaReadException::class.java) {
      selector(FakeDecoder("platform"), ThrowingDecoder(UnsatisfiedLinkError("missing")))
        .decode(24, ImageFormat.HEIF_CANDIDATE, source)
    }
    assertThrows(PrivateImageInvalidException::class.java) {
      selector(FakeDecoder("platform"), ThrowingDecoder(OutOfMemoryError("allocation")))
        .decode(24, ImageFormat.HEIF_CANDIDATE, source)
    }
  }

  private fun selector(
    platform: ObservationImageDecoder<String>,
    legacy: ObservationImageDecoder<String>,
  ) = ObservationImageDecoderSelector(platform, legacy)

  private fun failingSelector(failure: LegacyHeifFailure) = selector(
    FakeDecoder("platform"),
    ThrowingDecoder(LegacyHeifDecodeException(failure)),
  )

  private class FakeDecoder(
    private val value: String,
    private val orientationApplied: Boolean = false,
  ) : ObservationImageDecoder<String> {
    var calls = 0

    override fun decode(source: File): DecodedObservationImage<String> {
      calls++
      return DecodedObservationImage(value, orientationApplied)
    }
  }

  private class ThrowingDecoder(
    private val error: Throwable,
  ) : ObservationImageDecoder<String> {
    override fun decode(source: File): DecodedObservationImage<String> = throw error
  }
}
