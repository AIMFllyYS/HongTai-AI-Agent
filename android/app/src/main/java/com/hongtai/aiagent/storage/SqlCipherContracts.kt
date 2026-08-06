package com.hongtai.aiagent.storage

/**
 * Small adapter surface over Capacitor Community SQLite. Keeping it free of
 * Android types lets storage policy and repositories be unit-tested on the JVM.
 */
interface SqlCipherConnection {
  fun isEncryptionSecretStored(): Boolean
  fun setEncryptionSecret(passphrase: CharArray)
  fun checkEncryptionSecret(passphrase: CharArray): Boolean
  fun createEncryptedConnection()
  fun open()
  fun close()
  fun execute(statement: String, values: List<Any?> = emptyList())
  /** Executes one statement and returns its verified affected-row count. */
  fun executeWithChanges(statement: String, values: List<Any?> = emptyList()): Int
  fun query(statement: String, values: List<Any?> = emptyList()): List<Map<String, Any?>>
  fun <T> transaction(block: () -> T): T
}

interface SqlCipherPassphraseProvider {
  /** `existingDatabase` blocks accidental replacement of an unrecoverable key. */
  fun <T> withPassphrase(existingDatabase: Boolean, block: (CharArray) -> T): T
}

fun interface SqlCipherMigration {
  fun apply(connection: SqlCipherConnection)
}

/**
 * Opens exactly one encrypted Community SQLite connection. Errors are mapped
 * at the native boundary and no failure path invokes delete, reset, or rebuild.
 */
class SqlCipherBootstrap(
  private val connectionFactory: () -> SqlCipherConnection,
  private val passphraseProvider: SqlCipherPassphraseProvider,
  private val databaseAlreadyExists: () -> Boolean,
  private val migration: SqlCipherMigration,
) {
  fun open(): SqlCipherConnection = passphraseProvider.withPassphrase(databaseAlreadyExists()) { passphrase ->
    val connection = connectionFactory()
    try {
      initializeSecret(connection, passphrase)
      connection.createEncryptedConnection()
      connection.open()
      try {
        migration.apply(connection)
      } catch (error: Exception) {
        throw LocalStorageException(
          LocalStorageErrorCode.MIGRATION_FAILED,
          "The encrypted local database migration did not finish.",
          error,
        )
      }
      connection
    } catch (error: LocalStorageException) {
      closeQuietly(connection)
      throw error
    } catch (error: Exception) {
      closeQuietly(connection)
      throw LocalStorageException(
        LocalStorageErrorCode.DATABASE_OPEN_FAILED,
        "The encrypted local database could not be opened.",
        error,
      )
    }
  }

  private fun initializeSecret(connection: SqlCipherConnection, passphrase: CharArray) {
    try {
      if (connection.isEncryptionSecretStored()) {
        if (!connection.checkEncryptionSecret(passphrase)) {
          throw LocalStorageException(
            LocalStorageErrorCode.KEY_MISMATCH,
            "The Android Keystore database key does not match the existing SQLCipher key.",
          )
        }
      } else {
        connection.setEncryptionSecret(passphrase)
      }
    } catch (error: LocalStorageException) {
      throw error
    } catch (error: Exception) {
      throw LocalStorageException(
        LocalStorageErrorCode.COMMUNITY_SQLITE_INITIALIZATION_FAILED,
        "Capacitor Community SQLite could not initialize its encrypted secret.",
        error,
      )
    }
  }

  private fun closeQuietly(connection: SqlCipherConnection) {
    try {
      connection.close()
    } catch (_: Exception) {
      // Preserve the original failure; closing never authorizes deleting data.
    }
  }
}
