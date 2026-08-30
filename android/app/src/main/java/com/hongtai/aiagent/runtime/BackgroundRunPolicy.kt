package com.hongtai.aiagent.runtime

/**
 * In-memory policy flag for background running, set from the shared runtime
 * layer before long tasks start. While enabled, active native work no longer
 * keeps the screen on; the foreground service plus partial wake lock carry the
 * work instead, so the screen may turn off normally to save battery.
 *
 * Default is `false`, which preserves the legacy screen-stay behaviour. The
 * flag is process-local only: process death resets it to the default until
 * the runtime layer sets it again on the next task start.
 */
internal object BackgroundRunPolicy {
  @Volatile
  private var backgroundRunEnabled = false

  fun isEnabled(): Boolean = backgroundRunEnabled

  fun setEnabled(enabled: Boolean) {
    backgroundRunEnabled = enabled
  }
}
