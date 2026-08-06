package com.hongtai.aiagent.storage

/**
 * The SQLCipher adapter implements this port after Capacitor Community SQLite
 * has been synchronised. It is intentionally not backed by preferences or a
 * mock database: profile state belongs in the encrypted structured store.
 */
interface LocalProfileRepository {
  fun read(): LocalProfile?
  fun save(profile: LocalProfile)
}

/** Public connection metadata only. The corresponding API key stays in Keystore. */
interface LocalAiConnectionRepository {
  fun readAiConnection(): LocalAiConnection?
  fun saveAiConnection(connection: LocalAiConnection)
}

/** Native migration adapter port; failures must be surfaced and never reset the database. */
interface EncryptedSchemaMigrator {
  fun migrateToLatest(): Int
}
