package com.hongtai.aiagent.storage

enum class SqlCipherPassphraseAction {
  USE_EXISTING,
  CREATE,
  FAIL_KEY_MISSING,
}

/** Prevents a missing Keystore record from silently replacing an existing database key. */
object SqlCipherPassphrasePolicy {
  fun actionFor(
    existingDatabase: Boolean,
    protectedPassphraseExists: Boolean,
  ): SqlCipherPassphraseAction = when {
    protectedPassphraseExists -> SqlCipherPassphraseAction.USE_EXISTING
    existingDatabase -> SqlCipherPassphraseAction.FAIL_KEY_MISSING
    else -> SqlCipherPassphraseAction.CREATE
  }
}
