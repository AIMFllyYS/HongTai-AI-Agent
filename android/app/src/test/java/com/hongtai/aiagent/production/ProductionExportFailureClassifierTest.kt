package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductionExportFailureClassifierTest {
  @Test
  fun `keeps Media3 1_10_1 export errorCode integers`() {
    assertEquals(3001, ProductionExportFailureClassifier.ERROR_CODE_DECODER_INIT_FAILED)
    assertEquals(3002, ProductionExportFailureClassifier.ERROR_CODE_DECODING_FAILED)
    assertEquals(3003, ProductionExportFailureClassifier.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED)
    assertEquals(4001, ProductionExportFailureClassifier.ERROR_CODE_ENCODER_INIT_FAILED)
    assertEquals(4002, ProductionExportFailureClassifier.ERROR_CODE_ENCODING_FAILED)
    assertEquals(4003, ProductionExportFailureClassifier.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED)
    assertEquals(5001, ProductionExportFailureClassifier.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED)
    assertEquals(6001, ProductionExportFailureClassifier.ERROR_CODE_AUDIO_PROCESSING_FAILED)
  }

  @Test
  fun `splits encoder decode pipeline and unknown export codes`() {
    val encoderCodes = listOf(
      ProductionExportFailureClassifier.ERROR_CODE_ENCODER_INIT_FAILED,
      ProductionExportFailureClassifier.ERROR_CODE_ENCODING_FAILED,
      ProductionExportFailureClassifier.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED,
    )
    val decodeCodes = listOf(
      ProductionExportFailureClassifier.ERROR_CODE_DECODER_INIT_FAILED,
      ProductionExportFailureClassifier.ERROR_CODE_DECODING_FAILED,
      ProductionExportFailureClassifier.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
    )
    val pipelineCodes = listOf(
      ProductionExportFailureClassifier.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED,
      ProductionExportFailureClassifier.ERROR_CODE_AUDIO_PROCESSING_FAILED,
    )

    for (code in encoderCodes) {
      assertEquals(ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE, ProductionExportFailureClassifier.classifyExport(code))
    }
    for (code in decodeCodes) {
      assertEquals(ProductionFailureKind.MEDIA_DECODE_FAILED, ProductionExportFailureClassifier.classifyExport(code))
    }
    for (code in pipelineCodes) {
      assertEquals(ProductionFailureKind.MEDIA_RENDER_PIPELINE_FAILED, ProductionExportFailureClassifier.classifyExport(code))
    }
    assertEquals(ProductionFailureKind.MEDIA_EXPORT_FAILED, ProductionExportFailureClassifier.classifyExport(1000))
    assertEquals(ProductionFailureKind.MEDIA_EXPORT_FAILED, ProductionExportFailureClassifier.classifyExport(7001))
  }

  @Test
  fun `verification missing AAC is decode or no-audio and other checks are output invalid`() {
    assertEquals(
      ProductionFailureKind.MEDIA_DECODE_FAILED,
      ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.MISSING_AUDIO_AAC),
    )
    assertEquals(
      ProductionFailureKind.MEDIA_OUTPUT_INVALID,
      ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.MISSING_VIDEO_H264),
    )
    assertEquals(
      ProductionFailureKind.MEDIA_OUTPUT_INVALID,
      ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.NO_DURATION),
    )
    assertEquals(
      ProductionFailureKind.MEDIA_OUTPUT_INVALID,
      ProductionExportFailureClassifier.classifyVerification(ProductionOutputVerificationFailure.UNREADABLE),
    )
  }

  @Test
  fun `software H264 retry is only offered once after an encoder failure`() {
    assertTrue(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE,
        alreadyTriedSoftware = false,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE,
        alreadyTriedSoftware = true,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_DECODE_FAILED,
        alreadyTriedSoftware = false,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_RENDER_PIPELINE_FAILED,
        alreadyTriedSoftware = false,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_OUTPUT_INVALID,
        alreadyTriedSoftware = false,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_EXPORT_FAILED,
        alreadyTriedSoftware = false,
      ),
    )
    assertFalse(
      ProductionExportFailureClassifier.shouldRetryWithSoftware(
        ProductionFailureKind.MEDIA_RENDER_TIMEOUT,
        alreadyTriedSoftware = false,
      ),
    )
  }
}
