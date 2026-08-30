package com.hongtai.aiagent.runtime

import android.content.Context
import android.os.PowerManager

/**
 * Reference-counted PARTIAL_WAKE_LOCK holder for TaskGuard background running.
 *
 * Each guarded task kind contributes one named hold. The lock itself is
 * acquired when the total goes 0 -> 1 and released when it returns to 0, so
 * overlapping tasks keep the CPU awake across screen-off while the last
 * completed task releases it. Releasing an unknown or already-released kind is
 * tolerated as a no-op: the TS client guarantees paired hold/release in the
 * happy path, and tolerance keeps crash-recovery paths from poisoning the
 * counter.
 */
internal object TaskGuardWakeLock {
  private const val WAKE_LOCK_TAG = "hongtai:task-guard"

  private val holds = mutableMapOf<String, Int>()
  private var wakeLock: PowerManager.WakeLock? = null

  @Synchronized
  fun hold(context: Context, kind: String): Int {
    holds[kind] = (holds[kind] ?: 0) + 1
    val total = holds.values.sum()
    if (total == 1) {
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    return total
  }

  @Synchronized
  fun release(kind: String): Int {
    val current = holds[kind] ?: return holds.values.sum()
    val next = current - 1
    if (next <= 0) holds.remove(kind) else holds[kind] = next
    val total = holds.values.sum()
    if (total == 0) {
      wakeLock?.let { lock ->
        if (lock.isHeld) lock.release()
      }
      wakeLock = null
    }
    return total
  }

  @Synchronized
  fun totalHolds(): Int = holds.values.sum()
}
