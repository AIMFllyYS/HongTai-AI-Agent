package com.hongtai.aiagent.bridge

/** Stable errors consumed by the shared TaskIssue presentation mapper. */
object NativeIssueCode {
  const val INVALID_ARGUMENT = "ERR_INVALID_ARGUMENT"
  const val LOCAL_DATA_UNAVAILABLE = "ERR_LOCAL_DATA_UNAVAILABLE"
  const val SECURE_STORAGE_UNAVAILABLE = "ERR_SECURE_STORAGE_UNAVAILABLE"
  const val PRIVATE_FILE_IMPORT_FAILED = "ERR_PRIVATE_FILE_IMPORT_FAILED"
  const val MEDIA_PROBE_FAILED = "ERR_MEDIA_PROBE_FAILED"
  const val MEDIA_MERGE_FAILED = "ERR_MEDIA_MERGE_FAILED"
}
