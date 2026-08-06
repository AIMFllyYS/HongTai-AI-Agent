package com.hongtai.aiagent.storage

import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.community.database.sqlite.CapacitorSQLite
import com.getcapacitor.community.database.sqlite.SQLite.SqliteConfig
import java.util.Hashtable
import org.json.JSONObject

/**
 * Kotlin-only adapter over the installed Capacitor Community SQLite API. It
 * intentionally uses the same encrypted connection mode and database filename
 * as `CapacitorSQLite.createConnection("hongtai_local", ...)`.
 */
class CommunitySqlCipherConnection(context: Context) : SqlCipherConnection {
  private val appContext = context.applicationContext
  private val sqlite = try {
    CapacitorSQLite(
      appContext,
      SqliteConfig().apply {
        setIsEncryption(true)
        setBiometricAuth(false)
      },
    )
  } catch (error: Exception) {
    throw LocalStorageException(
      LocalStorageErrorCode.COMMUNITY_SQLITE_INITIALIZATION_FAILED,
      "Capacitor Community SQLite could not create its encrypted runtime.",
      error,
    )
  }

  private var connectionCreated = false

  override fun isEncryptionSecretStored(): Boolean = secretCall("read the encryption-secret state") {
    sqlite.isSecretStored()
  }

  override fun setEncryptionSecret(passphrase: CharArray) {
    secretCall("store the encryption secret") {
      sqlite.setEncryptionSecret(passphrase.concatToString())
    }
  }

  override fun checkEncryptionSecret(passphrase: CharArray): Boolean =
    secretCall("check the encryption secret") {
      sqlite.checkEncryptionSecret(passphrase.concatToString())
    }

  override fun createEncryptedConnection() {
    databaseCall("create the encrypted connection") {
      sqlite.createConnection(
        DATABASE_NAME,
        true,
        "secret",
        SchemaV1.version,
        Hashtable<Int, JSONObject>(),
        false,
      )
      connectionCreated = true
    }
  }

  override fun open() {
    databaseCall("open the encrypted database") {
      sqlite.open(DATABASE_NAME, false)
    }
  }

  override fun close() {
    if (connectionCreated) {
      databaseCall("close the encrypted database") {
        sqlite.closeConnection(DATABASE_NAME, false)
        connectionCreated = false
      }
    }
  }

  override fun execute(statement: String, values: List<Any?>) {
    databaseCall("execute an encrypted database statement") {
      sqlite.run(DATABASE_NAME, statement, values.toJsArray(), false, false, "no")
    }
  }

  override fun executeWithChanges(statement: String, values: List<Any?>): Int = databaseCall(
    "execute an encrypted database state transition",
  ) {
    val result = sqlite.run(DATABASE_NAME, statement, values.toJsArray(), false, false, "no")
    val changes = result.optInt("changes", -1)
    if (changes < 0) {
      throw IllegalStateException("Capacitor Community SQLite did not return an affected-row count.")
    }
    changes
  }

  override fun query(statement: String, values: List<Any?>): List<Map<String, Any?>> = databaseCall(
    "query the encrypted database",
  ) {
    val rows = sqlite.query(DATABASE_NAME, statement, values.toJsArray(), false)
    buildList {
      for (index in 0 until rows.length()) {
        add(rows.getJSONObject(index).toMap())
      }
    }
  }

  override fun <T> transaction(block: () -> T): T = databaseCall("run an encrypted transaction") {
    sqlite.beginTransaction(DATABASE_NAME)
    try {
      block().also { sqlite.commitTransaction(DATABASE_NAME) }
    } catch (error: Exception) {
      rollbackQuietly()
      throw error
    }
  }

  private fun <T> secretCall(operation: String, action: () -> T): T = SqlCipherNativeErrorMapper.call(
    LocalStorageErrorCode.COMMUNITY_SQLITE_INITIALIZATION_FAILED,
    operation,
    action,
  )

  private fun <T> databaseCall(operation: String, action: () -> T): T = SqlCipherNativeErrorMapper.call(
    LocalStorageErrorCode.DATABASE_OPEN_FAILED,
    operation,
    action,
  )

  private fun rollbackQuietly() {
    try {
      sqlite.rollbackTransaction(DATABASE_NAME)
    } catch (_: Exception) {
      // Preserve the original failure and never turn it into a reset/delete path.
    }
  }

  private fun List<Any?>.toJsArray(): JSArray = JSArray().also { array ->
    forEach { value -> array.put(value ?: JSONObject.NULL) }
  }

  private fun JSONObject.toMap(): Map<String, Any?> = buildMap {
    val keys = keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val value = opt(key)
      put(key, if (value == JSONObject.NULL) null else value)
    }
  }

  companion object {
    const val DATABASE_NAME = "hongtai_local"
    const val DATABASE_FILE_NAME = "${DATABASE_NAME}SQLite.db"
  }
}
