package com.hongtai.aiagent.production

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductionRenderWatchdogTest {
  @Test
  fun `timeout waits for cancel then stays MEDIA_RENDER_TIMEOUT even if export fails`() {
    val finished = CountDownLatch(1)
    val cancelInvoked = AtomicBoolean(false)
    val emitted = mutableListOf<Int>()
    val gate = ProductionRenderProgressGate { value, _ -> emitted += value }
    val watchdog = ProductionExportWatchdog(gate, timeoutMs = 120, pollIntervalMs = 40)

    val watch = watchdog.awaitExport(
      finished,
      onPoll = { gate.emit(40, "export") },
      onTimeout = {
        awaitExportStopAfterCancel(
          postCancel = { action ->
            Thread {
              action()
              finished.countDown()
            }.start()
            true
          },
          cancel = { cancelInvoked.set(true) },
          finished = finished,
          waitMs = 400,
        )
      },
    )

    assertTrue(watch is ProductionExportWatchResult.TimedOut)
    assertTrue((watch as ProductionExportWatchResult.TimedOut).exportStopped)
    assertTrue(cancelInvoked.get())
    assertEquals(
      ProductionExportResolution.Timeout,
      ProductionRenderTimeoutPolicy.resolve(watch, RuntimeException("export failed"), temporaryUsable = true),
    )
    gate.emit(100, "done")
    assertFalse(emitted.contains(100))
  }

  @Test
  fun `main-thread samples emit only on the worker flush and late samples are dropped`() {
    val emitted = mutableListOf<Int>()
    val gate = ProductionRenderProgressGate { value, _ -> emitted += value }

    gate.offerSample(48, "export")
    gate.flushPending()
    gate.stopSampling()
    gate.offerSample(80, "export")
    gate.flushPending()
    gate.emit(100, "done")
    gate.close()
    gate.emit(100, "done")

    assertEquals(listOf(48, 100), emitted)
  }

  @Test
  fun `close drops a sample that arrives from another thread`() {
    val emitted = mutableListOf<Int>()
    val gate = ProductionRenderProgressGate { value, _ ->
      synchronized(emitted) { emitted += value }
    }
    val started = CountDownLatch(1)
    val done = CountDownLatch(1)
    Thread {
      started.await()
      gate.offerSample(90, "late")
      gate.flushPending()
      gate.emit(100, "done")
      done.countDown()
    }.start()
    gate.close()
    started.countDown()

    assertTrue(done.await(1, TimeUnit.SECONDS))
    synchronized(emitted) { assertTrue(emitted.isEmpty()) }
  }

  @Test
  fun `finished export can verify while a cancel-induced failure cannot remap timeout`() {
    val finished = CountDownLatch(0)
    val gate = ProductionRenderProgressGate { _, _ -> }
    val watchdog = ProductionExportWatchdog(gate, timeoutMs = 400, pollIntervalMs = 40)

    val watch = watchdog.awaitExport(finished, onPoll = {}, onTimeout = { false })

    assertEquals(ProductionExportWatchResult.Finished, watch)
    assertEquals(
      ProductionExportResolution.ReadyToVerify,
      ProductionRenderTimeoutPolicy.resolve(watch, null, temporaryUsable = true),
    )
    assertEquals(
      ProductionExportResolution.ExportFailed,
      ProductionRenderTimeoutPolicy.resolve(watch, RuntimeException("export failed"), temporaryUsable = true),
    )
    assertEquals(
      ProductionExportResolution.Timeout,
      ProductionRenderTimeoutPolicy.resolve(
        ProductionExportWatchResult.TimedOut(exportStopped = true),
        RuntimeException("export failed"),
        temporaryUsable = true,
      ),
    )
  }

  @Test
  fun `incomplete part is discarded only after export stopped and output mp4 is kept`() {
    val directory = Files.createTempDirectory("hongtai-render-watchdog").toFile()
    try {
      val part = File(directory, ".output.part.mp4").apply { writeText("partial") }
      val output = File(directory, "output.mp4").apply { writeText("previous") }

      ProductionRenderTimeoutPolicy.discardIncompletePart(part, exportStopped = false)
      assertTrue(part.exists())
      assertEquals("previous", output.readText())

      ProductionRenderTimeoutPolicy.discardIncompletePart(part, exportStopped = true)
      assertFalse(part.exists())
      assertEquals("previous", output.readText())
    } finally {
      directory.deleteRecursively()
    }
  }

  @Test
  fun `cancel is observed before waiting for export stop`() {
    val finished = CountDownLatch(1)
    val order = mutableListOf<String>()
    val stopped = awaitExportStopAfterCancel(
      postCancel = { action ->
        Thread {
          Thread.sleep(40)
          action()
          order += "cancelled"
          finished.countDown()
        }.start()
        true
      },
      cancel = { order += "invoke" },
      finished = finished,
      waitMs = 400,
    )

    assertTrue(stopped)
    assertEquals(listOf("invoke", "cancelled"), order)
  }
}
