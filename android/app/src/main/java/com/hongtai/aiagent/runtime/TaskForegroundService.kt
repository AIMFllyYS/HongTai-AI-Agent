package com.hongtai.aiagent.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.hongtai.aiagent.R

/**
 * Provides a truthful foreground notification for a task owned by the future
 * native ingest worker. START_NOT_STICKY prevents Android from pretending an
 * interrupted operation resumed after force-stop or process death.
 */
class TaskForegroundService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val taskId = intent?.getStringExtra(EXTRA_TASK_ID) ?: return START_NOT_STICKY
    val title = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.app_name)
    val message = intent.getStringExtra(EXTRA_MESSAGE) ?: "正在执行本地任务"
    val notification = createNotification(title, message)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // Keep the ID in the notification until the phase-5 worker owns progress.
    currentTaskId = taskId
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    currentTaskId = null
    super.onDestroy()
  }

  private fun createNotification(title: String, message: String): Notification {
    ensureChannel()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(title)
      .setContentText(message)
      .setOngoing(true)
      .build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.foreground_task_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.foreground_task_channel_description)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "hongtai.local-tasks.v1"
    private const val NOTIFICATION_ID = 7101
    private const val EXTRA_TASK_ID = "taskId"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_MESSAGE = "message"

    @Volatile
    var currentTaskId: String? = null
      private set

    fun start(context: Context, taskId: String, title: String, message: String) {
      val intent = Intent(context, TaskForegroundService::class.java)
        .putExtra(EXTRA_TASK_ID, taskId)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_MESSAGE, message)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, TaskForegroundService::class.java))
    }
  }
}
