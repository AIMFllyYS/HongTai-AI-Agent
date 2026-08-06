package com.hongtai.aiagent.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

/** JVM-only contract check for process-death recovery. */
class TaskRecoveryTest {
  @Test
  fun `only queued and running tasks become interrupted after process recovery`() {
    val recovered = TaskRecovery.recover(
      listOf(
        PersistedTaskState("queued-task", RuntimeTaskStatus.QUEUED),
        PersistedTaskState("running-task", RuntimeTaskStatus.RUNNING),
        PersistedTaskState("done-task", RuntimeTaskStatus.SUCCEEDED),
        PersistedTaskState("cancelled-task", RuntimeTaskStatus.CANCELLED),
      ),
    )

    assertEquals(listOf("queued-task", "running-task"), recovered)
  }
}
