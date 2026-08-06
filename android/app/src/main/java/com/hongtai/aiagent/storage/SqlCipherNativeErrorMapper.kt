package com.hongtai.aiagent.storage

/** Converts third-party SQLite exceptions into stable native bridge errors. */
internal object SqlCipherNativeErrorMapper {
  fun <T> call(
    code: LocalStorageErrorCode,
    operation: String,
    action: () -> T,
  ): T = try {
    action()
  } catch (error: LocalStorageException) {
    throw error
  } catch (error: Exception) {
    throw LocalStorageException(
      code,
      "Capacitor Community SQLite could not $operation.",
      error,
    )
  }
}
