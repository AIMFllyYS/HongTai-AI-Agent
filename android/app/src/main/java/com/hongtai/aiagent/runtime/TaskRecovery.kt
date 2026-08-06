package com.hongtai.aiagent.runtime

enum class RuntimeTaskStatus {
  QUEUED,
  RUNNING,
  SUCCEEDED,
  DEGRADED,
  FAILED,
  CANCELLED,
  INTERRUPTED,
}

data class PersistedTaskState(
  val taskId: String,
  val status: RuntimeTaskStatus,
)

/**
 * A task that was queued or running when the process disappeared has no trusted
 * worker to resume. It becomes interrupted and must be manually retried.
 */
object TaskRecovery {
  fun recover(tasks: Iterable<PersistedTaskState>): List<String> = tasks
    .filter { it.status == RuntimeTaskStatus.QUEUED || it.status == RuntimeTaskStatus.RUNNING }
    .map { it.taskId }
}

interface TaskRecoveryStore {
  fun listTaskStatesForRecovery(): List<PersistedTaskState>
  /** Returns false if the task changed state after it was selected for recovery. */
  fun markInterrupted(taskId: String, interruptedAtEpochMs: Long): Boolean
}

class StartupRecoveryCoordinator(
  private val store: TaskRecoveryStore,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  fun recoverAfterUncleanLaunch(): List<String> {
    val recoverableTaskIds = TaskRecovery.recover(store.listTaskStatesForRecovery())
    val interruptedAt = clock()
    return recoverableTaskIds.filter { taskId -> store.markInterrupted(taskId, interruptedAt) }
  }
}
