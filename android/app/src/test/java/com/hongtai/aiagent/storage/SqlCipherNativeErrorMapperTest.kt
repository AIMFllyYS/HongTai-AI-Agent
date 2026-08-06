package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SqlCipherNativeErrorMapperTest {
  @Test
  fun `wraps a community SQLite exception in a stable local storage error`() {
    val cause = IllegalStateException("database closed")

    try {
      SqlCipherNativeErrorMapper.call(LocalStorageErrorCode.DATABASE_OPEN_FAILED, "query the encrypted database") {
        throw cause
      }
    } catch (error: LocalStorageException) {
      assertEquals(LocalStorageErrorCode.DATABASE_OPEN_FAILED, error.code)
      assertSame(cause, error.cause)
      return
    }

    throw AssertionError("Expected LocalStorageException")
  }

  @Test
  fun `does not replace an existing stable local storage error`() {
    val existing = LocalStorageException(LocalStorageErrorCode.DATA_CORRUPTED, "bad row")

    try {
      SqlCipherNativeErrorMapper.call(LocalStorageErrorCode.DATABASE_OPEN_FAILED, "query the encrypted database") {
        throw existing
      }
    } catch (error: LocalStorageException) {
      assertSame(existing, error)
      return
    }

    throw AssertionError("Expected LocalStorageException")
  }
}
