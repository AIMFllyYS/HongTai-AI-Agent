package com.hongtai.aiagent.runtime

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.WindowManager

enum class ActiveWorkScreenStayAction {
  NONE,
  KEEP_ON,
  ALLOW_OFF,
}

/**
 * Counts overlapping import/render jobs so the screen stays awake only while
 * at least one of them is running.
 */
internal class ActiveWorkScreenStayCounter {
  private var holds = 0

  @Synchronized
  fun acquire(): ActiveWorkScreenStayAction {
    holds += 1
    return if (holds == 1) ActiveWorkScreenStayAction.KEEP_ON else ActiveWorkScreenStayAction.NONE
  }

  @Synchronized
  fun release(): ActiveWorkScreenStayAction {
    check(holds > 0) { "Active work screen stay released without a matching acquire." }
    holds -= 1
    return if (holds == 0) ActiveWorkScreenStayAction.ALLOW_OFF else ActiveWorkScreenStayAction.NONE
  }

  @Synchronized
  fun holds(): Int = holds
}

/**
 * Applies `FLAG_KEEP_SCREEN_ON` on the host Activity while native import or
 * render work is in flight. Idle pages keep the system timeout.
 */
internal object ActiveWorkScreenStay {
  private val counter = ActiveWorkScreenStayCounter()
  private val main = Handler(Looper.getMainLooper())

  fun acquire(activity: Activity?) {
    apply(activity, counter.acquire())
  }

  fun release(activity: Activity?) {
    apply(activity, counter.release())
  }

  private fun apply(activity: Activity?, action: ActiveWorkScreenStayAction) {
    if (action == ActiveWorkScreenStayAction.NONE) return
    val host = activity ?: return
    val keepOn = action == ActiveWorkScreenStayAction.KEEP_ON
    val update = Runnable {
      if (host.isDestroyed) return@Runnable
      // While background running is enabled, guarded work must survive with
      // the screen off (foreground service + partial wake lock), so the
      // screen-stay flag is skipped on acquire. Clearing on release stays
      // unconditional and is harmless when the flag was never added.
      if (keepOn && BackgroundRunPolicy.isEnabled()) return@Runnable
      if (keepOn) {
        host.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        host.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) update.run() else main.post(update)
  }
}
