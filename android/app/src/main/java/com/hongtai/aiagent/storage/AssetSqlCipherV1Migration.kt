package com.hongtai.aiagent.storage

import android.content.Context

/** Runs the immutable v1 asset in one transaction; it never attempts recovery by clearing data. */
class AssetSqlCipherV1Migration(context: Context) : SqlCipherMigration {
  private val appContext = context.applicationContext

  override fun apply(connection: SqlCipherConnection) {
    SqlCipherMigrationRunner.applyV1IfNeeded(connection, readStatements = {
      appContext.assets.open(SchemaV1.migrationAssetPath).bufferedReader().use { reader ->
        SqlStatementSplitter.split(reader.readText())
      }
    })
  }
}
