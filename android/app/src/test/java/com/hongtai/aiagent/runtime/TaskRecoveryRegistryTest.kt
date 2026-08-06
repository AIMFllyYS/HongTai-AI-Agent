package com.hongtai.aiagent.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

private class RegistryRecoveryStore(
  private var states: List<PersistedTaskState>,
) : TaskRecoveryStore {
  val interruptedTaskIds = mutableListOf<String>()

  override fun listTaskStatesForRecovery(): List<PersistedTaskState> = states

  override fun markInterrupted(taskId: String, interruptedAtEpochMs: Long): Boolean {
    interruptedTaskIds += taskId
    return true
  }

  fun replaceStates(nextStates: List<PersistedTaskState>) {
    states = nextStates
  }
}

class TaskRecoveryRegistryTest {
  @Test
  fun `preserves the concrete encrypted storage error for the UI mapper`() {
    TaskRecoveryRegistry.markStorageUnavailable("ERR_SQLCIPHER_KEY_MISSING")

    val result = TaskRecoveryRegistry.latestStartupResult()

    assertEquals(
      TaskRecoveryStartupResult.StorageUnavailable("ERR_SQLCIPHER_KEY_MISSING"),
      result,
    )
    assertEquals(emptyList<String>(), TaskRecoveryRegistry.latestRecoveredTaskIds())
  }

  @Test
  fun `recovers only once after an install even if a bridge asks again`() {
    val store = RegistryRecoveryStore(
      listOf(PersistedTaskState("startup-task", RuntimeTaskStatus.QUEUED)),
    )
    TaskRecoveryRegistry.install(store)

    val startup = TaskRecoveryRegistry.recoverAtStartup()
    store.replaceStates(listOf(PersistedTaskState("new-task", RuntimeTaskStatus.QUEUED)))
    val repeated = TaskRecoveryRegistry.recoverAtStartup()

    assertEquals(TaskRecoveryStartupResult.Recovered(listOf("startup-task")), startup)
    assertEquals(startup, repeated)
    assertEquals(listOf("startup-task"), store.interruptedTaskIds)
  }
}
