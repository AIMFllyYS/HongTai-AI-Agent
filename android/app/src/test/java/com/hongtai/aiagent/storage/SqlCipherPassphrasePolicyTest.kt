package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class SqlCipherPassphrasePolicyTest {
  @Test
  fun `requires existing keystore key when sqlcipher database already exists`() {
    assertEquals(
      SqlCipherPassphraseAction.FAIL_KEY_MISSING,
      SqlCipherPassphrasePolicy.actionFor(existingDatabase = true, protectedPassphraseExists = false),
    )
    assertEquals(
      SqlCipherPassphraseAction.CREATE,
      SqlCipherPassphrasePolicy.actionFor(existingDatabase = false, protectedPassphraseExists = false),
    )
    assertEquals(
      SqlCipherPassphraseAction.USE_EXISTING,
      SqlCipherPassphrasePolicy.actionFor(existingDatabase = true, protectedPassphraseExists = true),
    )
  }
}
