package com.hongtai.aiagent.storage

/** Bridges the Keystore-only passphrase policy into the SQLCipher bootstrap. */
class AndroidKeystoreSqlCipherPassphraseProvider(
  private val secretStore: AndroidKeystoreSecretStore,
) : SqlCipherPassphraseProvider {
  override fun <T> withPassphrase(existingDatabase: Boolean, block: (CharArray) -> T): T = try {
    secretStore.withSqlCipherPassphrase(existingDatabase, block)
  } catch (error: LocalStorageException) {
    throw error
  } catch (error: SecureStorageException) {
    throw LocalStorageException(
      LocalStorageErrorCode.KEYSTORE_UNAVAILABLE,
      "Android Keystore could not provide the SQLCipher database key.",
      error,
    )
  }
}
