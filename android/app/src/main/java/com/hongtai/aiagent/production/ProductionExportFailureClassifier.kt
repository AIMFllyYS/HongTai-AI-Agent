package com.hongtai.aiagent.production

/** Verification-stage reasons that must not reuse the export-failure dumpster. */
internal enum class ProductionOutputVerificationFailure {
  MISSING_VIDEO_H264,
  MISSING_AUDIO_AAC,
  NO_DURATION,
  UNREADABLE,
}

/**
 * Pure classifier for Media3 export and output-verification failures.
 * It maps integer [ExportException.errorCode] values and verification stages
 * only; it never copies Throwable text or decides UI copy.
 */
internal object ProductionExportFailureClassifier {
  // Media3 1.10.1 ExportException.errorCode values, kept as integers so JVM
  // unit tests do not load Android or Media3 types.
  const val ERROR_CODE_DECODER_INIT_FAILED = 3001
  const val ERROR_CODE_DECODING_FAILED = 3002
  const val ERROR_CODE_DECODING_FORMAT_UNSUPPORTED = 3003
  const val ERROR_CODE_ENCODER_INIT_FAILED = 4001
  const val ERROR_CODE_ENCODING_FAILED = 4002
  const val ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED = 4003
  const val ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED = 5001
  const val ERROR_CODE_AUDIO_PROCESSING_FAILED = 6001

  fun classifyExport(errorCode: Int): ProductionFailureKind = when (errorCode) {
    ERROR_CODE_ENCODER_INIT_FAILED,
    ERROR_CODE_ENCODING_FAILED,
    ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED -> ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE
    ERROR_CODE_DECODER_INIT_FAILED,
    ERROR_CODE_DECODING_FAILED,
    ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> ProductionFailureKind.MEDIA_DECODE_FAILED
    ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED,
    ERROR_CODE_AUDIO_PROCESSING_FAILED -> ProductionFailureKind.MEDIA_RENDER_PIPELINE_FAILED
    else -> ProductionFailureKind.MEDIA_EXPORT_FAILED
  }

  fun classifyVerification(reason: ProductionOutputVerificationFailure): ProductionFailureKind = when (reason) {
    ProductionOutputVerificationFailure.MISSING_AUDIO_AAC -> ProductionFailureKind.MEDIA_DECODE_FAILED
    ProductionOutputVerificationFailure.MISSING_VIDEO_H264,
    ProductionOutputVerificationFailure.NO_DURATION,
    ProductionOutputVerificationFailure.UNREADABLE -> ProductionFailureKind.MEDIA_OUTPUT_INVALID
  }

  fun shouldRetryWithSoftware(kind: ProductionFailureKind, alreadyTriedSoftware: Boolean): Boolean =
    !alreadyTriedSoftware && kind == ProductionFailureKind.MEDIA_ENCODER_UNAVAILABLE
}
