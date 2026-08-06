package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class MigrationRecordingConnection : SqlCipherConnection {
  val executed = mutableListOf<String>()
  var applied = false
  var transactionCount = 0

  override fun isEncryptionSecretStored(): Boolean = true
  override fun setEncryptionSecret(passphrase: CharArray) = Unit
  override fun checkEncryptionSecret(passphrase: CharArray): Boolean = true
  override fun createEncryptedConnection() = Unit
  override fun open() = Unit
  override fun close() = Unit

  override fun execute(statement: String, values: List<Any?>) {
    executed += statement
    if (statement.startsWith("UPDATE schema_migrations")) applied = true
  }

  override fun executeWithChanges(statement: String, values: List<Any?>): Int {
    execute(statement, values)
    return 1
  }

  override fun query(statement: String, values: List<Any?>): List<Map<String, Any?>> =
    if (statement.contains("FROM schema_migrations") && applied) listOf(mapOf("version" to SchemaV1.version)) else emptyList()

  override fun <T> transaction(block: () -> T): T {
    transactionCount += 1
    return block()
  }
}

class SqlCipherMigrationRunnerTest {
  @Test
  fun `applies v1 once and records its version in the same transaction`() {
    val connection = MigrationRecordingConnection()

    val applied = SqlCipherMigrationRunner.applyV1IfNeeded(
      connection,
      readStatements = { listOf("CREATE TABLE profiles(id TEXT)") },
      nowEpochMs = { 42L },
    )

    assertTrue(applied)
    assertEquals(1, connection.transactionCount)
    assertTrue(connection.executed.any { it.contains("CREATE TABLE profiles") })
    assertTrue(connection.executed.any { it.startsWith("UPDATE schema_migrations") })
  }

  @Test
  fun `does not rerun v1 statements after its version is recorded`() {
    val connection = MigrationRecordingConnection().apply { applied = true }

    val applied = SqlCipherMigrationRunner.applyV1IfNeeded(
      connection,
      readStatements = { error("A recorded migration must not re-read its asset.") },
    )

    assertFalse(applied)
    assertEquals(1, connection.transactionCount)
    assertFalse(connection.executed.any { it.contains("CREATE TABLE profiles") })
  }
}
