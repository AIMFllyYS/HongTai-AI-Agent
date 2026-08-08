package com.hongtai.aiagent.media

/**
 * Gives camera staging files a constrained leaf name. The system camera only
 * receives a FileProvider content URI; the final file is always re-imported
 * into the regular private-media directory before it reaches the WebView.
 */
internal object PhotoCapturePolicy {
  private val captureId = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,99}")
  private val captureFileName = Regex("capture-[A-Za-z0-9][A-Za-z0-9_-]{0,99}\\.jpg")

  fun fileNameFor(identifier: String): String {
    require(captureId.matches(identifier)) { "Capture identifier is invalid." }
    return "capture-$identifier.jpg"
  }

  fun isCaptureFileName(value: String): Boolean = captureFileName.matches(value)
}
