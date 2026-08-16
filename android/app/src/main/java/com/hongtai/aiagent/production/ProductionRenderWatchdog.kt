package com.hongtai.aiagent.production

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal enum class ProductionExportResolution {
  Timeout,
  ExportFailed,
  ReadyToVerify,
}

internal sealed class ProductionExportWatchResult {
  data object Finished : ProductionExportWatchResult()
  data class TimedOut(val exportStopped: Boolean) : ProductionExportWatchResult()
}

/**
 * Bounds Media3 export waiting. Timeout always wins over a cancel-induced
 * export error so the caller never remaps that path to MEDIA_EXPORT_FAILED.
 */
internal object ProductionRenderTimeoutPolicy {
  const val RENDER_TIMEOUT_MS = 180_000L
  const val CANCEL_WAIT_MS = 10_000L
  const val POLL_INTERVAL_MS = 500L

  fun resolve(
    watch: ProductionExportWatchResult,
    exportFailure: Throwable?,
    temporaryUsable: Boolean,
  ): ProductionExportResolution = when (watch) {
    is ProductionExportWatchResult.TimedOut -> ProductionExportResolution.Timeout
    ProductionExportWatchResult.Finished -> when {
      exportFailure != null || !temporaryUsable -> ProductionExportResolution.ExportFailed
      else -> ProductionExportResolution.ReadyToVerify
    }
  }

  fun discardIncompletePart(part: File, exportStopped: Boolean) {
    if (!exportStopped) return
    if (part.exists()) part.delete()
  }
}

/**
 * Progress samples may be offered from the main-thread getProgress poll.
 * Emission is a single serial channel and is dropped after timeout/terminal.
 */
internal enum class ProductionRenderStage(val wireName: String) {
  VALIDATE_AVATAR_AUDIO("validate_avatar_audio"),
  SYNTHESIZE_NARRATION("synthesize_narration"),
  COMPILE_SHOTS("compile_shots"),
  EXPORT("export"),
  SAVED("saved"),
}

internal class ProductionRenderProgressGate(
  private val onProgress: (Int, String) -> Unit,
) {
  private val closed = AtomicBoolean(false)
  private val sampling = AtomicBoolean(true)
  private val pending = AtomicReference<Pair<Int, String>?>()
  private val gate = Any()

  fun emit(progress: Int, stage: String) {
    synchronized(gate) {
      if (closed.get()) return
      onProgress(progress, stage)
    }
  }

  fun offerSample(progress: Int, stage: String) {
    if (!sampling.get() || closed.get()) return
    pending.set(progress to stage)
  }

  fun flushPending() {
    val sample = pending.getAndSet(null) ?: return
    emit(sample.first, sample.second)
  }

  fun stopSampling() {
    sampling.set(false)
    pending.set(null)
  }

  fun close() {
    synchronized(gate) {
      closed.set(true)
      sampling.set(false)
      pending.set(null)
    }
  }
}

internal class ProductionExportWatchdog(
  private val progress: ProductionRenderProgressGate,
  private val timeoutMs: Long = ProductionRenderTimeoutPolicy.RENDER_TIMEOUT_MS,
  private val pollIntervalMs: Long = ProductionRenderTimeoutPolicy.POLL_INTERVAL_MS,
) {
  fun awaitExport(
    finished: CountDownLatch,
    onPoll: () -> Unit,
    onTimeout: () -> Boolean,
  ): ProductionExportWatchResult {
    var elapsedMs = 0L
    while (!finished.await(pollIntervalMs, TimeUnit.MILLISECONDS)) {
      elapsedMs += pollIntervalMs
      if (elapsedMs >= timeoutMs) {
        progress.close()
        return ProductionExportWatchResult.TimedOut(onTimeout())
      }
      onPoll()
    }
    progress.stopSampling()
    return ProductionExportWatchResult.Finished
  }
}

/** Posts cancel, waits until that runnable ran, then waits boundedly for finished. */
internal fun awaitExportStopAfterCancel(
  postCancel: (() -> Unit) -> Boolean,
  cancel: () -> Unit,
  finished: CountDownLatch,
  waitMs: Long = ProductionRenderTimeoutPolicy.CANCEL_WAIT_MS,
): Boolean {
  val invoked = CountDownLatch(1)
  val accepted = postCancel {
    try {
      cancel()
    } finally {
      invoked.countDown()
    }
  }
  if (accepted) {
    invoked.await(waitMs, TimeUnit.MILLISECONDS)
  }
  return finished.await(waitMs, TimeUnit.MILLISECONDS)
}
