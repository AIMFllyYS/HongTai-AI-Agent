package com.hongtai.aiagent.production

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The renderer's audio-ready consumption contract: sentence audio produced by the front-loaded
 * stage is mapped onto shot order, and anything missing or unreadable is refused before Media3
 * starts — never rendered as silent narration.
 */
class ProductionNarrationAssetsTest {
  private val directory = Files.createTempDirectory("hongtai-narration-assets").toFile()

  @After
  fun tearDown() {
    directory.deleteRecursively()
  }

  @Test
  fun `maps sentence audio onto shot order with each shot measured duration`() {
    val one = audioFile("s-1")
    val two = audioFile("s-2")
    val plan = measuredPlan(shot("s-1", 3_200L), shot("s-2", 4_100L))

    val narration = ProductionNarrationAssets.resolve(
      plan,
      mapOf("s-2" to "audio/narration-s-s-2.wav", "s-1" to "audio/narration-s-s-1.wav"),
      ::openRelative,
    )

    assertEquals(listOf(one to 3_200L, two to 4_100L), narration)
  }

  @Test
  fun `refuses an empty asset map instead of rendering silent narration`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionNarrationAssets.resolve(measuredPlan(shot("s-1", 1_000L)), emptyMap(), ::openRelative)
    }
  }

  @Test
  fun `refuses a legacy shot that has no measured sentence reference`() {
    val legacy = ProductionShot(
      1,
      ProductionInput("image-1", "/private/image-1.jpg", ProductionAssetKind.IMAGE),
      5_000L,
      "先看环境。",
      "真实环境",
      "cover",
    )

    assertThrows(IllegalArgumentException::class.java) {
      ProductionNarrationAssets.resolve(
        measuredPlan(legacy),
        mapOf("s-1" to "audio/narration-s-s-1.wav"),
        ::openRelative,
      )
    }
  }

  @Test
  fun `refuses a shot whose sentence audio was never synthesized`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionNarrationAssets.resolve(
        measuredPlan(shot("s-1", 1_000L)),
        mapOf("other" to "audio/narration-s-other.wav"),
        ::openRelative,
      )
    }
  }

  @Test
  fun `refuses sentence audio that is missing on disk or unreadable`() {
    audioFile("s-1")

    assertThrows(IllegalArgumentException::class.java) {
      ProductionNarrationAssets.resolve(
        measuredPlan(shot("s-1", 1_000L), shot("s-2", 1_500L)),
        mapOf(
          "s-1" to "audio/narration-s-s-1.wav",
          "s-2" to "audio/narration-s-s-2.wav",
        ),
        ::openRelative,
      )
    }
  }

  @Test
  fun `refuses blank asset entries`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionNarrationAssets.resolve(
        measuredPlan(shot("s-1", 1_000L)),
        mapOf("s-1" to " "),
        ::openRelative,
      )
    }
  }

  private fun openRelative(relativePath: String): File = File(directory, relativePath)

  private fun audioFile(sentenceId: String): File =
    File(directory, NarrationSentenceAssets.relativePath(sentenceId)).apply {
      parentFile?.mkdirs()
      writeText(sentenceId)
    }

  private fun shot(sentenceId: String, durationMs: Long): ProductionShot = ProductionShot(
    1,
    ProductionInput("image-1", "/private/image-1.jpg", ProductionAssetKind.IMAGE),
    durationMs,
    "第 $sentenceId 句。",
    "第 $sentenceId 句",
    "cover",
    emptyList(),
    sentenceId,
  )

  private fun measuredPlan(vararg shots: ProductionShot): NativeProductionPlan = NativeProductionPlan(
    width = 720,
    height = 1280,
    fps = 30,
    durationMs = shots.sumOf { it.durationMs },
    voiceLocale = "zh-CN",
    speechRate = 1f,
    backgroundMusic = null,
    backgroundMusicVolume = 0f,
    shots = shots.toList(),
  )
}
