package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeSqlCipherConnection : SqlCipherConnection {
  var storedSecret = false
  var checkedSecret = false
  var createdConnection = false
  var opened = false
  var closed = false
  val executedStatements = mutableListOf<String>()

  override fun isEncryptionSecretStored(): Boolean = storedSecret

  override fun setEncryptionSecret(passphrase: CharArray) {
    storedSecret = passphrase.concatToString() == "db-passphrase"
  }

  override fun checkEncryptionSecret(passphrase: CharArray): Boolean {
    checkedSecret = true
    return passphrase.concatToString() == "db-passphrase"
  }

  override fun createEncryptedConnection() {
    createdConnection = true
  }

  override fun open() {
    opened = true
  }

  override fun close() {
    closed = true
  }

  override fun execute(statement: String, values: List<Any?>) {
    executedStatements += statement
  }

  override fun executeWithChanges(statement: String, values: List<Any?>): Int {
    executedStatements += statement
    return 1
  }

  override fun query(statement: String, values: List<Any?>): List<Map<String, Any?>> = emptyList()

  override fun <T> transaction(block: () -> T): T = block()
}

private class FakePassphraseProvider(
  private val passphrase: CharArray = "db-passphrase".toCharArray(),
) : SqlCipherPassphraseProvider {
  var receivedExistingDatabaseFlag: Boolean? = null

  override fun <T> withPassphrase(existingDatabase: Boolean, block: (CharArray) -> T): T {
    receivedExistingDatabaseFlag = existingDatabase
    return block(passphrase)
  }
}

class SqlCipherBootstrapTest {
  @Test
  fun `initializes encrypted community connection before applying v1 migration`() {
    val connection = FakeSqlCipherConnection()
    val passphraseProvider = FakePassphraseProvider()
    val bootstrap = SqlCipherBootstrap(
      connectionFactory = { connection },
      passphraseProvider = passphraseProvider,
      databaseAlreadyExists = { false },
      migration = SqlCipherMigration { opened -> opened.execute("CREATE TABLE profiles") },
    )

    val opened = bootstrap.open()

    assertEquals(connection, opened)
    assertEquals(false, passphraseProvider.receivedExistingDatabaseFlag)
    assertTrue(connection.storedSecret)
    assertTrue(connection.createdConnection)
    assertTrue(connection.opened)
    assertEquals(listOf("CREATE TABLE profiles"), connection.executedStatements)
  }

  @Test
  fun `closes a connection when v1 migration fails without deleting data`() {
    val connection = FakeSqlCipherConnection()
    val bootstrap = SqlCipherBootstrap(
      connectionFactory = { connection },
      passphraseProvider = FakePassphraseProvider(),
      databaseAlreadyExists = { true },
      migration = SqlCipherMigration { throw IllegalStateException("broken migration") },
    )

    try {
      bootstrap.open()
    } catch (error: LocalStorageException) {
      assertEquals(LocalStorageErrorCode.MIGRATION_FAILED, error.code)
    }

    assertTrue(connection.closed)
    assertFalse(connection.executedStatements.any { it.contains("DELETE DATABASE") })
  }
}
