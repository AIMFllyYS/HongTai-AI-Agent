package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProductionPlanParserTest {
  private val assets = mapOf(
    "image-1" to ProductionInput("image-1", "/private/image-1.jpg", ProductionAssetKind.IMAGE),
    "video-1" to ProductionInput("video-1", "/private/video-1.mp4", ProductionAssetKind.VIDEO),
  )

  @Test
  fun `parses a bounded portrait plan and keeps explicit image frame duration`() {
    val plan = ProductionPlanParser.parse(validPlan(), assets)

    assertEquals(720, plan.width)
    assertEquals(1280, plan.height)
    assertEquals(30, plan.fps)
    assertEquals(20_000L, plan.durationMs)
    assertEquals(8_000L, plan.shots.first().durationMs)
    assertEquals(ProductionAssetKind.IMAGE, plan.shots.first().input.kind)
    assertEquals("看得见的真实服务", plan.textOverlay.primaryText)
    assertEquals("aqua_accent", plan.textOverlay.preset)
  }

  @Test
  fun `rejects unknown assets and mismatched shot duration`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("image-1", "missing"), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"durationSeconds\":12", "\"durationSeconds\":11"), assets)
    }
  }

  @Test
  fun `avatar plan uses one sequential audible source and cannot exceed its duration`() {
    val avatarAssets = mapOf(
      "avatar-1" to ProductionInput("avatar-1", "/private/avatar-1.mp4", ProductionAssetKind.VIDEO, durationMs = 15_000L, hasAudio = true),
    )

    val plan = ProductionPlanParser.parse(avatarPlan(), avatarAssets, ProductionRenderMode.AVATAR)

    assertEquals(ProductionRenderMode.AVATAR, plan.renderMode)
    assertEquals(3, plan.shots.size)
    assertEquals(15_000L, plan.shots.sumOf(ProductionShot::durationMs))

    assertThrows(ProductionException::class.java) {
      ProductionPlanParser.parse(avatarPlan(), avatarAssets.mapValues { (_, input) -> input.copy(hasAudio = false) }, ProductionRenderMode.AVATAR)
    }
    assertThrows(ProductionException::class.java) {
      ProductionPlanParser.parse(avatarPlan(), avatarAssets.mapValues { (_, input) -> input.copy(durationMs = 14_000L) }, ProductionRenderMode.AVATAR)
    }
  }

  private fun validPlan(): String = """
    {
      "schemaVersion":"production-plan.v2",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店真实体验",
      "settings":{"width":720,"height":1280,"fps":30,"durationSeconds":20},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "textOverlay":{"primaryText":"看得见的真实服务","secondaryText":"先看环境，再看过程","preset":"aqua_accent"},
      "shots":[
        {"order":1,"assetId":"image-1","durationSeconds":8,"narration":"先看环境。","caption":"真实环境","fit":"cover"},
        {"order":2,"assetId":"video-1","durationSeconds":12,"narration":"再看服务。","caption":"服务过程","fit":"contain"}
      ]
    }
  """.trimIndent()

  private fun avatarPlan(): String = """
    {
      "schemaVersion":"production-plan.v1",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店介绍",
      "settings":{"width":720,"height":1280,"fps":30,"durationSeconds":15},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "shots":[
        {"order":1,"assetId":"avatar-1","durationSeconds":5,"narration":"欢迎来到我们的门店。","caption":"欢迎来到我们的门店。","fit":"contain"},
        {"order":2,"assetId":"avatar-1","durationSeconds":5,"narration":"今天带你看看真实服务过程。","caption":"今天带你看看真实服务过程。","fit":"contain"},
        {"order":3,"assetId":"avatar-1","durationSeconds":5,"narration":"欢迎安心了解。","caption":"欢迎安心了解。","fit":"contain"}
      ]
    }
  """.trimIndent()
}
