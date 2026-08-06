package com.hongtai.aiagent.storage

/** Stable native errors. None of these paths delete or recreate application data. */
enum class LocalStorageErrorCode(val wireCode: String) {
  KEYSTORE_UNAVAILABLE("ERR_SQLCIPHER_KEYSTORE_UNAVAILABLE"),
  KEY_MISSING_FOR_EXISTING_DATABASE("ERR_SQLCIPHER_KEY_MISSING"),
  KEY_MISMATCH("ERR_SQLCIPHER_KEY_MISMATCH"),
  COMMUNITY_SQLITE_INITIALIZATION_FAILED("ERR_SQLCIPHER_INITIALIZATION_FAILED"),
  DATABASE_OPEN_FAILED("ERR_SQLCIPHER_OPEN_FAILED"),
  MIGRATION_FAILED("ERR_SQLCIPHER_MIGRATION_FAILED"),
  DATA_CORRUPTED("ERR_SQLCIPHER_DATA_CORRUPTED"),
}

class LocalStorageException(
  val code: LocalStorageErrorCode,
  message: String,
  cause: Throwable? = null,
) : RuntimeException(message, cause)
