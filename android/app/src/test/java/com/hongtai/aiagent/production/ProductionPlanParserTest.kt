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

  private fun validPlan(): String = """
    {
      "schemaVersion":"production-plan.v1",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店真实体验",
      "settings":{"width":720,"height":1280,"fps":30,"durationSeconds":20},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "shots":[
        {"order":1,"assetId":"image-1","durationSeconds":8,"narration":"先看环境。","caption":"真实环境","fit":"cover"},
        {"order":2,"assetId":"video-1","durationSeconds":12,"narration":"再看服务。","caption":"服务过程","fit":"contain"}
      ]
    }
  """.trimIndent()
}
