package com.hongtai.aiagent.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

private class RecordingRecoveryStore(
  private val tasks: List<PersistedTaskState>,
) : TaskRecoveryStore {
  val interruptedTaskIds = mutableListOf<String>()

  override fun listTaskStatesForRecovery(): List<PersistedTaskState> = tasks

  override fun markInterrupted(taskId: String, interruptedAtEpochMs: Long): Boolean {
    assertEquals(1234L, interruptedAtEpochMs)
    interruptedTaskIds += taskId
    return true
  }
}

/** Confirms startup recovery persists only states that cannot safely resume. */
class StartupRecoveryCoordinatorTest {
  @Test
  fun `persists interrupted status for queued and running tasks only`() {
    val store = RecordingRecoveryStore(
      listOf(
        PersistedTaskState("queued-task", RuntimeTaskStatus.QUEUED),
        PersistedTaskState("running-task", RuntimeTaskStatus.RUNNING),
        PersistedTaskState("finished-task", RuntimeTaskStatus.SUCCEEDED),
      ),
    )

    val recovered = StartupRecoveryCoordinator(store, clock = { 1234L })
      .recoverAfterUncleanLaunch()

    assertEquals(listOf("queued-task", "running-task"), recovered)
    assertEquals(recovered, store.interruptedTaskIds)
  }

  @Test
  fun `does not report a task whose compare-and-set recovery lost a race`() {
    val store = object : TaskRecoveryStore {
      override fun listTaskStatesForRecovery(): List<PersistedTaskState> = listOf(
        PersistedTaskState("changed-task", RuntimeTaskStatus.RUNNING),
      )

      override fun markInterrupted(taskId: String, interruptedAtEpochMs: Long): Boolean = false
    }

    assertEquals(emptyList<String>(), StartupRecoveryCoordinator(store).recoverAfterUncleanLaunch())
  }
}
