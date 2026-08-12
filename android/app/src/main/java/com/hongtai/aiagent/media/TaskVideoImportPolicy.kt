package com.hongtai.aiagent.media

import java.util.Locale

/** Pure validation performed before a user-selected video can become a task artifact. */
internal object TaskVideoImportPolicy {
  const val MAX_BYTES = 250L * 1024L * 1024L

  fun requireSupported(
    sourceScheme: String?,
    mimeType: String?,
    declaredBytes: Long?,
    header: ByteArray,
  ) {
    require(sourceScheme == "content") { "Only system content URIs may be imported as task videos." }
    require(mimeType?.lowercase(Locale.ROOT) == "video/mp4") { "Only MP4 task videos are supported." }
    if (declaredBytes != null) {
      require(declaredBytes in 1..MAX_BYTES) { "The selected task video exceeds the supported size limit." }
    }
    require(header.size >= 8 && header.copyOfRange(4, 8).contentEquals(FTYP)) {
      "The selected task video is not an MP4 file."
    }
  }

  private val FTYP = byteArrayOf(0x66, 0x74, 0x79, 0x70)
}
