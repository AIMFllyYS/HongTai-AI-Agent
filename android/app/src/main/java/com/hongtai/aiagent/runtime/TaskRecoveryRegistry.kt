package com.hongtai.aiagent.runtime

/**
 * Storage wiring is installed by the SQLCipher adapter at application startup.
 * A missing adapter is an explicit startup failure, never an empty recovery.
 */
object TaskRecoveryRegistry {
  @Volatile
  private var coordinator: StartupRecoveryCoordinator? = null

  @Volatile
  private var latestInterruptedTaskIds: List<String> = emptyList()

  @Volatile
  private var latestStartupResult: TaskRecoveryStartupResult = TaskRecoveryStartupResult.StorageUnavailable(
    DEFAULT_STORAGE_ERROR_CODE,
  )

  @Volatile
  private var storageErrorCode: String? = DEFAULT_STORAGE_ERROR_CODE

  /**
   * Recovery is a process-start operation, not a command that may be replayed
   * by the WebView. Replaying it after a user creates a new queued task would
   * incorrectly mark that task as interrupted.
   */
  @Volatile
  private var startupRecoveryCompleted = false

  @Synchronized
  fun install(store: TaskRecoveryStore) {
    coordinator = StartupRecoveryCoordinator(store)
    storageErrorCode = null
    latestInterruptedTaskIds = emptyList()
    latestStartupResult = TaskRecoveryStartupResult.StorageUnavailable(DEFAULT_STORAGE_ERROR_CODE)
    startupRecoveryCompleted = false
  }

  /** Records a fail-closed startup state; the caller may offer a manual retry. */
  @Synchronized
  fun markStorageUnavailable(errorCode: String) {
    coordinator = null
    latestInterruptedTaskIds = emptyList()
    storageErrorCode = errorCode
    latestStartupResult = TaskRecoveryStartupResult.StorageUnavailable(errorCode)
    startupRecoveryCompleted = true
  }

  @Synchronized
  fun recoverAtStartup(): TaskRecoveryStartupResult {
    if (startupRecoveryCompleted) return latestStartupResult
    val installedCoordinator = coordinator ?: return TaskRecoveryStartupResult.StorageUnavailable(
      storageErrorCode ?: DEFAULT_STORAGE_ERROR_CODE,
    ).also {
      latestStartupResult = it
      startupRecoveryCompleted = true
    }
    return TaskRecoveryStartupResult.Recovered(
      installedCoordinator.recoverAfterUncleanLaunch().also { latestInterruptedTaskIds = it },
    ).also {
      latestStartupResult = it
      startupRecoveryCompleted = true
    }
  }

  fun latestRecoveredTaskIds(): List<String> = latestInterruptedTaskIds

  fun latestStartupResult(): TaskRecoveryStartupResult = latestStartupResult

  private const val DEFAULT_STORAGE_ERROR_CODE = "ERR_TASK_RECOVERY_STORAGE_UNAVAILABLE"
}

sealed interface TaskRecoveryStartupResult {
  data class Recovered(val taskIds: List<String>) : TaskRecoveryStartupResult
  data class StorageUnavailable(val errorCode: String) : TaskRecoveryStartupResult
}
