package com.hongtai.aiagent.storage

import android.content.Context

/** Process-local owner for the one encrypted v1 connection. */
object LocalEncryptedStorage {
  @Volatile
  private var activeStore: SqlCipherLocalStore? = null

  @Synchronized
  fun initialize(context: Context): SqlCipherLocalStore {
    activeStore?.let { return it }

    val appContext = context.applicationContext
    val migration = AssetSqlCipherV1Migration(appContext)
    val connection = SqlCipherBootstrap(
      connectionFactory = { CommunitySqlCipherConnection(appContext) },
      passphraseProvider = AndroidKeystoreSqlCipherPassphraseProvider(
        AndroidKeystoreSecretStore(appContext),
      ),
      databaseAlreadyExists = {
        appContext.getDatabasePath(CommunitySqlCipherConnection.DATABASE_FILE_NAME).exists()
      },
      migration = migration,
    ).open()
    return SqlCipherLocalStore(connection, migration).also { activeStore = it }
  }

  fun requireStore(): SqlCipherLocalStore = activeStore ?: throw LocalStorageException(
    LocalStorageErrorCode.DATABASE_OPEN_FAILED,
    "Encrypted local storage has not been initialized.",
  )
}
