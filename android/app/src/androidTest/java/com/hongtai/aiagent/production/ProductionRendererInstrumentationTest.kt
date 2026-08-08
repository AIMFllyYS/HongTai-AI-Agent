package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.media.MediaExtractor
import androidx.media3.common.util.UnstableApi
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@UnstableApi
@RunWith(AndroidJUnit4::class)
class ProductionRendererInstrumentationTest {
  @Test
  fun rendersRealLengthPortraitShotsWithSegmentedSystemNarrationAndCaptions() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val projectId = "instrumentation-production"
    val inputsDirectory = File(context.filesDir, "productions/$projectId/inputs").apply { mkdirs() }
    val inputs = listOf(Color.rgb(16, 93, 82), Color.rgb(231, 170, 92), Color.rgb(44, 62, 80)).mapIndexed { index, color ->
      val file = File(inputsDirectory, "asset-${index + 1}.jpg")
      Bitmap.createBitmap(360, 640, Bitmap.Config.ARGB_8888).also { bitmap ->
        Canvas(bitmap).drawColor(color)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        bitmap.recycle()
      }
      ProductionInput("asset-${index + 1}", file.absolutePath, ProductionAssetKind.IMAGE)
    }
    val narrations = listOf(
      "在我们这里，每一只小生命都值得被温柔以待。",
      "我们提供专业的喂养建议，用心守护它们的健康。",
      "干净的环境，耐心的陪伴，让它们在这里快乐成长。",
      "因为爱，所以用心。欢迎带您和家人一起来看看。",
    )
    val durations = listOf(3_000L, 4_000L, 4_000L, 4_000L)
    val plan = NativeProductionPlan(
      width = 720,
      height = 1280,
      fps = 30,
      durationMs = 15_000,
      voiceLocale = "zh-CN",
      speechRate = 1f,
      backgroundMusic = null,
      backgroundMusicVolume = 0f,
      shots = narrations.mapIndexed { index, narration ->
        ProductionShot(index + 1, inputs[index % inputs.size], durations[index], narration, "真实镜头 ${index + 1}", "cover")
      },
    )

    val progress = mutableListOf<Int>()
    val result = ProductionRenderer(context, ProductionMediaStore(context)).render(projectId, plan) { value, _ -> progress += value }

    assertTrue(result.sizeBytes > 0)
    assertTrue(result.durationSeconds in 14.5..15.5)
    assertEquals(100, progress.last())
    val extractor = MediaExtractor()
    extractor.setDataSource(requireNotNull(android.net.Uri.parse(result.uri).path))
    val formats = (0 until extractor.trackCount).map(extractor::getTrackFormat)
    val mimes = formats.map { it.getString("mime") }
    val videoFormat = formats.first { it.getString("mime")?.startsWith("video/") == true }
    val rotation = videoFormat.getInteger(android.media.MediaFormat.KEY_ROTATION, 0)
    val encodedWidth = videoFormat.getInteger(android.media.MediaFormat.KEY_WIDTH)
    val encodedHeight = videoFormat.getInteger(android.media.MediaFormat.KEY_HEIGHT)
    val displayWidth = if (rotation % 180 == 0) encodedWidth else encodedHeight
    val displayHeight = if (rotation % 180 == 0) encodedHeight else encodedWidth
    extractor.release()
    assertTrue(mimes.any { it?.startsWith("video/") == true })
    assertTrue(mimes.any { it?.startsWith("audio/") == true })
    assertEquals("video/avc", videoFormat.getString("mime"))
    assertEquals(720, displayWidth)
    assertEquals(1280, displayHeight)
  }
}
