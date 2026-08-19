package com.hongtai.aiagent.production

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.media3.common.util.UnstableApi
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@UnstableApi
@RunWith(AndroidJUnit4::class)
class ProductionRendererInstrumentationTest {
  @Test
  fun rendersV3MontageWithRealMp4CuesAndSticker() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val projectId = "instrumentation-production-v3"
    val inputsDirectory = File(context.filesDir, "productions/$projectId/inputs").apply { mkdirs() }
    val image = writeSolidJpeg(File(inputsDirectory, "asset-1.jpg"), Color.rgb(16, 93, 82))
    val video = copyFixture(File(inputsDirectory, "asset-2.mp4"))
    val imageInput = ProductionInput("asset-1", image.absolutePath, ProductionAssetKind.IMAGE)
    val videoInput = ProductionInput("asset-2", video.absolutePath, ProductionAssetKind.VIDEO, durationMs = 16_000L, hasAudio = true)
    val template = classicLineTemplate()
    val plan = NativeProductionPlan(
      width = 720,
      height = 1280,
      fps = 30,
      durationMs = 15_000,
      voiceLocale = "zh-CN",
      speechRate = 1f,
      backgroundMusic = null,
      backgroundMusicVolume = 0f,
      textOverlay = ProductionTextOverlay("真实服务", "看得见过程", "classic_top"),
      shots = listOf(
        ProductionShot(
          1, imageInput, 5_000L, "先看真实环境。", "真实环境", "cover",
          listOf(
            SubtitleCue(0, 2_500, "先看真实环境", listOf("真实"), null),
            SubtitleCue(2_500, 5_000, "看得见的过程", emptyList(), null),
          ),
        ),
        ProductionShot(
          2, videoInput, 5_000L, "再看完整服务。", "服务过程", "cover",
          listOf(SubtitleCue(0, 5_000, "服务过程全程可看", emptyList(), null)),
        ),
        ProductionShot(
          3, imageInput, 5_000L, "欢迎安心了解。", "欢迎了解", "cover",
          listOf(SubtitleCue(0, 5_000, "欢迎安心了解", emptyList(), null)),
        ),
      ),
      subtitleTemplate = template,
      decorations = listOf(
        ProductionDecorationSpec("sticker", "arrow_right", null, 1, 500, 2_500, "above_caption", 1f, "fade"),
        ProductionDecorationSpec("floating_text", null, "限时", 2, 1_000, 3_000, "top_right", 1f, "pop"),
      ),
    )

    val evidence = renderAndVerify(context, projectId, plan, expectDuration = 14.5..15.5)
    assertTrue(evidence.length() > 0)
  }

  @Test
  fun rendersAvatarModeFromSequentialSlicesOfRealMp4() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val projectId = "instrumentation-production-avatar"
    val inputsDirectory = File(context.filesDir, "productions/$projectId/inputs").apply { mkdirs() }
    val video = copyFixture(File(inputsDirectory, "avatar-1.mp4"))
    val avatar = ProductionInput("avatar-1", video.absolutePath, ProductionAssetKind.VIDEO, durationMs = 16_000L, hasAudio = true)
    val template = classicLineTemplate()
    val captions = listOf("欢迎来到门店", "今天看看真实服务", "欢迎安心了解")
    val plan = NativeProductionPlan(
      width = 720,
      height = 1280,
      fps = 30,
      durationMs = 15_000,
      voiceLocale = "zh-CN",
      speechRate = 1f,
      backgroundMusic = null,
      backgroundMusicVolume = 0f,
      textOverlay = ProductionTextOverlay("门店介绍", null, "classic_top"),
      shots = captions.mapIndexed { index, caption ->
        ProductionShot(
          index + 1, avatar, 5_000L, "$caption。", caption, "contain",
          listOf(SubtitleCue(0, 5_000, caption, emptyList(), null)),
        )
      },
      renderMode = ProductionRenderMode.AVATAR,
      subtitleTemplate = template,
    )

    renderAndVerify(context, projectId, plan, expectDuration = 14.5..15.5)
  }

  @Test
  fun garbageMp4IsClassifiedDecodeOrExportFailureNotGenericMerge() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val projectId = "instrumentation-production-decode-fail"
    val inputsDirectory = File(context.filesDir, "productions/$projectId/inputs").apply { mkdirs() }
    val bogus = File(inputsDirectory, "broken.mp4").apply { writeText("not a video") }
    val input = ProductionInput("asset-1", bogus.absolutePath, ProductionAssetKind.VIDEO, durationMs = 15_000L, hasAudio = true)
    val template = classicLineTemplate()
    val plan = NativeProductionPlan(
      width = 720,
      height = 1280,
      fps = 30,
      durationMs = 15_000,
      voiceLocale = "zh-CN",
      speechRate = 1f,
      backgroundMusic = null,
      backgroundMusicVolume = 0f,
      textOverlay = ProductionTextOverlay("失败分类", null, "classic_top"),
      shots = listOf(
        ProductionShot(
          1, input, 15_000L, "这不是有效视频。", "无效素材", "cover",
          listOf(SubtitleCue(0, 15_000, "无效素材", emptyList(), null)),
        ),
      ),
      subtitleTemplate = template,
    )
    try {
      ProductionRenderer(context, ProductionMediaStore(context)).render(projectId, plan, FixtureNarrationSynthesizer(ProductionMediaStore(context))) { _, _ -> }
      org.junit.Assert.fail("expected a classified ProductionException")
    } catch (error: ProductionException) {
      android.util.Log.i("HongTaiEvidence", "garbageMp4 kind=${error.kind}")
      assertTrue(
        error.kind == ProductionFailureKind.MEDIA_DECODE_FAILED ||
          error.kind == ProductionFailureKind.MEDIA_EXPORT_FAILED ||
          error.kind == ProductionFailureKind.MEDIA_RENDER_PIPELINE_FAILED,
      )
    }
  }

  private fun renderAndVerify(
    context: Context,
    projectId: String,
    plan: NativeProductionPlan,
    expectDuration: ClosedFloatingPointRange<Double>,
  ): File {
    val progress = mutableListOf<Int>()
    val store = ProductionMediaStore(context)
    val result = ProductionRenderer(context, store).render(projectId, plan, FixtureNarrationSynthesizer(store)) { value, _ ->
      progress += value
    }
    assertTrue(result.sizeBytes > 0)
    assertTrue(result.durationSeconds in expectDuration)
    assertEquals(100, progress.last())
    val path = requireNotNull(android.net.Uri.parse(result.uri).path)
    val extractor = MediaExtractor()
    extractor.setDataSource(path)
    val formats = (0 until extractor.trackCount).map(extractor::getTrackFormat)
    val mimes = formats.map { it.getString(MediaFormat.KEY_MIME) }
    val videoFormat = formats.first { it.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
    val rotation = videoFormat.getInteger(MediaFormat.KEY_ROTATION, 0)
    val encodedWidth = videoFormat.getInteger(MediaFormat.KEY_WIDTH)
    val encodedHeight = videoFormat.getInteger(MediaFormat.KEY_HEIGHT)
    val displayWidth = if (rotation % 180 == 0) encodedWidth else encodedHeight
    val displayHeight = if (rotation % 180 == 0) encodedHeight else encodedWidth
    extractor.release()
    assertEquals("video/avc", videoFormat.getString(MediaFormat.KEY_MIME))
    assertTrue(mimes.contains("audio/mp4a-latm"))
    assertEquals(720, displayWidth)
    assertEquals(1280, displayHeight)
    val evidence = File(requireNotNull(context.getExternalFilesDir(null)), "$projectId-output.mp4")
    File(path).copyTo(evidence, overwrite = true)
    assertEquals(result.sizeBytes, evidence.length())
    val digest = MessageDigest.getInstance("SHA-256").digest(evidence.readBytes())
    val sha256 = digest.joinToString("") { byte -> "%02x".format(byte) }
    File(evidence.parentFile, "$projectId-output.sha256").writeText("$sha256  ${evidence.name}\n${evidence.length()}\n")
    android.util.Log.i("HongTaiEvidence", "$projectId size=${evidence.length()} sha256=$sha256")
    return evidence
  }

  private fun writeSolidJpeg(file: File, color: Int): File {
    Bitmap.createBitmap(360, 640, Bitmap.Config.ARGB_8888).also { bitmap ->
      Canvas(bitmap).drawColor(color)
      file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      bitmap.recycle()
    }
    return file
  }

  private fun copyFixture(destination: File): File {
    InstrumentationRegistry.getInstrumentation().context.assets.open("production/portrait-16s.mp4").use { input ->
      destination.outputStream().use { output -> input.copyTo(output) }
    }
    return destination
  }

  private fun classicLineTemplate(): SubtitleTemplateSpec = SubtitleTemplateSpec(
    id = "classic_line",
    typography = SubtitleTypographySpec(46f, 1.25f, 700, 0.5f, 2, 14),
    layout = SubtitleLayoutSpec("center", 260f, 48f),
    fillArgb = 0xFFFFFFFFu.toInt(),
    stroke = SubtitleStrokeSpec(0xE6001815u.toInt(), 6f),
    box = null,
    entrance = SubtitleEntranceSpec("fade", 180, "standard", 0f),
    wordReveal = "none",
    pendingArgb = null,
    emphasis = SubtitleEmphasisSpec("recolor", 0xFF64F4DAu.toInt(), 1f, 0, "standard"),
  )
}

/**
 * The renderer test owns its audio fixture. Depending on an emulator's system
 * TTS voice makes Media3 coverage fail when that voice requires a network
 * download, even though rendering itself is healthy.
 */
private class FixtureNarrationSynthesizer(
  private val store: ProductionMediaStore,
) : NarrationSynthesizer {
  override fun synthesize(projectId: String, plan: NativeProductionPlan): List<Pair<File, Long>> = plan.shots.map { shot ->
    val output = File(store.audioDirectory(projectId), "fixture-narration-${shot.order}.wav")
    writePcmWav(output, shot.durationMs)
    output to shot.durationMs
  }

  private fun writePcmWav(output: File, durationMs: Long) {
    val sampleCount = (durationMs * SAMPLE_RATE / 1_000L).toInt()
    val dataSize = sampleCount * BYTES_PER_SAMPLE
    val header = ByteBuffer.allocate(WAV_HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt(36 + dataSize)
      put("WAVE".toByteArray(Charsets.US_ASCII))
      put("fmt ".toByteArray(Charsets.US_ASCII))
      putInt(16)
      putShort(1)
      putShort(1)
      putInt(SAMPLE_RATE)
      putInt(SAMPLE_RATE * BYTES_PER_SAMPLE)
      putShort(BYTES_PER_SAMPLE.toShort())
      putShort(BITS_PER_SAMPLE.toShort())
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataSize)
    }
    val pcm = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
      repeat(sampleCount) { index ->
        val phase = 2.0 * Math.PI * TONE_HZ * index / SAMPLE_RATE
        putShort((sin(phase) * AMPLITUDE).toInt().toShort())
      }
    }
    output.outputStream().use { stream ->
      stream.write(header.array())
      stream.write(pcm.array())
      stream.fd.sync()
    }
  }

  private companion object {
    const val SAMPLE_RATE = 16_000
    const val BITS_PER_SAMPLE = 16
    const val BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
    const val WAV_HEADER_BYTES = 44
    const val TONE_HZ = 220.0
    const val AMPLITUDE = 1_200.0
  }
}
