package com.hongtai.aiagent.storage

/**
 * Version-aware migration runner for the encrypted store. It records the
 * applied version in the same transaction as the schema statements and never
 * tries to repair a failed migration by deleting local data.
 */
internal object SqlCipherMigrationRunner {
  private const val ENSURE_MIGRATIONS_TABLE = """
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at_epoch_ms INTEGER NOT NULL
    )
  """

  fun applyV1IfNeeded(
    connection: SqlCipherConnection,
    readStatements: () -> List<String>,
    nowEpochMs: () -> Long = System::currentTimeMillis,
  ): Boolean = connection.transaction {
    connection.execute(ENSURE_MIGRATIONS_TABLE.trimIndent())
    val alreadyApplied = connection.query(
      "SELECT version FROM schema_migrations WHERE version = ?",
      listOf(SchemaV1.version),
    ).isNotEmpty()
    if (alreadyApplied) return@transaction false

    val statements = readStatements()
    require(statements.isNotEmpty()) { "The v1 migration asset is empty." }
    statements.forEach(connection::execute)
    val appliedAtEpochMs = nowEpochMs()
    // The v1 asset also contains this INSERT for compatibility with a plain
    // SQL import. Keep the runner authoritative when the asset evolves.
    connection.execute(
      "INSERT OR IGNORE INTO schema_migrations(version, applied_at_epoch_ms) VALUES (?, ?)",
      listOf(SchemaV1.version, appliedAtEpochMs),
    )
    connection.execute(
      "UPDATE schema_migrations SET applied_at_epoch_ms = ? WHERE version = ?",
      listOf(appliedAtEpochMs, SchemaV1.version),
    )
    true
  }
}
