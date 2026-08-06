package com.hongtai.aiagent.storage

import com.hongtai.aiagent.runtime.PersistedTaskState
import com.hongtai.aiagent.runtime.RuntimeTaskStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private class RecordingSqlCipherConnection : SqlCipherConnection {
  val executed = mutableListOf<Pair<String, List<Any?>>>()
  val queried = mutableListOf<Pair<String, List<Any?>>>()
  var transactionCount = 0
  var conditionalUpdateChanges = 1

  override fun isEncryptionSecretStored(): Boolean = true
  override fun setEncryptionSecret(passphrase: CharArray) = Unit
  override fun checkEncryptionSecret(passphrase: CharArray): Boolean = true
  override fun createEncryptedConnection() = Unit
  override fun open() = Unit
  override fun close() = Unit

  override fun execute(statement: String, values: List<Any?>) {
    executed += statement to values
  }

  override fun executeWithChanges(statement: String, values: List<Any?>): Int {
    executed += statement to values
    return conditionalUpdateChanges
  }

  override fun query(statement: String, values: List<Any?>): List<Map<String, Any?>> {
    queried += statement to values
    return when {
    statement.contains("MAX(sequence)") -> listOf(mapOf("next_sequence" to 4L))
    statement.contains("FROM tasks") -> listOf(
      mapOf("id" to "running-task", "status" to "running"),
    )
    else -> emptyList()
    }
  }

  override fun <T> transaction(block: () -> T): T {
    transactionCount += 1
    return block()
  }
}

class SqlCipherLocalStoreTest {
  @Test
  fun `saves the complete local profile without a remote account requirement`() {
    val connection = RecordingSqlCipherConnection()
    val store = SqlCipherLocalStore(connection, SqlCipherMigration { })
    val profile = LocalProfile(
      localProfileId = "local-profile",
      remoteAccountId = null,
      displayName = "本地用户",
      avatarUri = "file:///private/avatar.jpg",
      businessName = "宏泰门店",
      industry = "健康服务",
      businessTagsJson = "[\"调理\"]",
      createdAtEpochMs = 1L,
      updatedAtEpochMs = 2L,
    )

    store.save(profile)

    val write = connection.executed.single()
    assertTrue(write.first.contains("INSERT INTO profiles"))
    assertEquals(
      listOf(
        SqlCipherLocalStore.LOCAL_PROFILE_ID,
        null,
        "本地用户",
        "file:///private/avatar.jpg",
        "宏泰门店",
        "健康服务",
        "[\"调理\"]",
        1L,
        2L,
      ),
      write.second.take(9),
    )
  }

  @Test
  fun `marks recovery task interrupted and appends the next persisted event`() {
    val connection = RecordingSqlCipherConnection()
    val store = SqlCipherLocalStore(connection, SqlCipherMigration { })

    assertEquals(
      listOf(PersistedTaskState("running-task", RuntimeTaskStatus.RUNNING)),
      store.listTaskStatesForRecovery(),
    )

    store.markInterrupted("running-task", 99L)

    assertEquals(1, connection.transactionCount)
    assertTrue(connection.executed.any { (statement, values) ->
      statement.contains("UPDATE tasks") &&
        statement.contains("status IN") &&
        values == listOf("interrupted", 99L, "running-task", "queued", "running")
    })
    assertTrue(connection.executed.any { (statement, values) ->
      statement.contains("INSERT INTO task_events") && values.contains(4L) && values.contains("interrupted")
    })
  }

  @Test
  fun `does not append an interruption event when the task changed state before recovery`() {
    val connection = RecordingSqlCipherConnection().apply { conditionalUpdateChanges = 0 }
    val store = SqlCipherLocalStore(connection, SqlCipherMigration { })

    val interrupted = store.markInterrupted("running-task", 99L)

    assertEquals(false, interrupted)
    assertTrue(connection.queried.none { (statement, _) -> statement.contains("MAX(sequence)") })
    assertTrue(connection.executed.none { (statement, _) -> statement.contains("INSERT INTO task_events") })
  }

  @Test
  fun `normalizes local profile and connection writes to their single native records`() {
    val connection = RecordingSqlCipherConnection()
    val store = SqlCipherLocalStore(connection, SqlCipherMigration { })

    store.save(
      LocalProfile(
        localProfileId = "web-supplied-id",
        remoteAccountId = null,
        displayName = "本地用户",
        avatarUri = null,
        businessName = null,
        industry = null,
        businessTagsJson = "[]",
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 2L,
      ),
    )
    store.saveAiConnection(
      LocalAiConnection(
        connectionId = "web-supplied-id",
        baseUrl = "https://example.invalid/v1",
        textModel = "text-model",
        visionModel = null,
        asrModel = null,
        asrTransport = null,
        jsonObjectEnabled = false,
        jsonSchemaEnabled = false,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 2L,
      ),
    )

    assertEquals(SqlCipherLocalStore.LOCAL_PROFILE_ID, connection.executed[0].second.first())
    assertEquals(SqlCipherLocalStore.ACTIVE_AI_CONNECTION_ID, connection.executed[1].second.first())
  }

  @Test
  fun `saves only public AI connection fields`() {
    val connection = RecordingSqlCipherConnection()
    val store = SqlCipherLocalStore(connection, SqlCipherMigration { })

    store.saveAiConnection(
      LocalAiConnection(
        connectionId = "active",
        baseUrl = "https://example.invalid/v1",
        textModel = "text-model",
        visionModel = "vision-model",
        asrModel = "asr-model",
        asrTransport = "standard",
        jsonObjectEnabled = true,
        jsonSchemaEnabled = false,
        createdAtEpochMs = 10L,
        updatedAtEpochMs = 11L,
      ),
    )

    val write = connection.executed.single()
    assertTrue(write.first.contains("INSERT INTO ai_connections"))
    assertTrue(!write.first.contains("api_key"))
    assertTrue(!write.second.any { it?.toString()?.contains("secret", ignoreCase = true) == true })
  }
}
