package com.hongtai.aiagent.media

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real end-to-end remux coverage: B-frame (H.264 High) video plus AAC audio,
 * the combination Bilibili DASH sources always ship. The framework muxer path
 * previously rejected their non-monotonic presentation timestamps outright;
 * this test locks in that both tracks are preserved with their original
 * sample sequence.
 */
@RunWith(AndroidJUnit4::class)
class TaskRemuxBFrameInstrumentationTest {
  @Test
  fun bFrameVideoAndAacAudioRemuxIntoVerifiableMp4() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val taskId = "task-remux-bframe-instrumentation"
    val mediaDirectory = File(context.filesDir, "tasks/$taskId/media").apply { mkdirs() }
    val video = copyAsset("bframes-video.mp4", File(mediaDirectory, "video-source.bin"))
    val audio = copyAsset("bframes-audio.m4a", File(mediaDirectory, "audio-source.bin"))
    val taskRoot = File(context.filesDir, "tasks/$taskId")

    try {
      val output = AndroidMediaRuntime(context).remuxVideoNow(
        taskId,
        android.net.Uri.fromFile(video).toString(),
        android.net.Uri.fromFile(audio).toString(),
      )
      val outputFile = File(requireNotNull(android.net.Uri.parse(output.uri).path))
      try {
        assertEquals("video/mp4", output.mimeType)
        assertTrue(output.hasAudio)
        assertTrue(outputFile.isFile)
        assertTrue(output.sizeBytes in 1..(video.length() + audio.length() + 8 * 1024 * 1024))
        // The merged output must itself pass the strict task-media input gate.
        val probe = AndroidMediaRuntime(context).probeNow(output.uri)
        assertEquals(true, probe.hasVideo)
        assertEquals(true, probe.hasAudio)
      } finally {
        outputFile.delete()
      }
    } finally {
      taskRoot.deleteRecursively()
    }
  }

  @Test
  fun bFrameVideoAloneRemuxesWithoutAudioTrack() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val taskId = "task-remux-bframe-video-only"
    val mediaDirectory = File(context.filesDir, "tasks/$taskId/media").apply { mkdirs() }
    val video = copyAsset("bframes-video.mp4", File(mediaDirectory, "video-source.bin"))
    val taskRoot = File(context.filesDir, "tasks/$taskId")

    try {
      val output = AndroidMediaRuntime(context).remuxVideoNow(
        taskId,
        android.net.Uri.fromFile(video).toString(),
        null,
      )
      val outputFile = File(requireNotNull(android.net.Uri.parse(output.uri).path))
      try {
        assertTrue(outputFile.isFile)
        assertEquals(false, output.hasAudio)
        val probe = AndroidMediaRuntime(context).probeNow(output.uri)
        assertEquals(true, probe.hasVideo)
      } finally {
        outputFile.delete()
      }
    } finally {
      taskRoot.deleteRecursively()
    }
  }

  private fun copyAsset(name: String, destination: File): File {
    InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { input ->
      destination.outputStream().use(input::copyTo)
    }
    return destination
  }
}
