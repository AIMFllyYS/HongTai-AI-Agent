package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
  fun `rejects unknown assets mismatched shot duration and invalid export profile`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("image-1", "missing"), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"durationSeconds\":12", "\"durationSeconds\":11"), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"width\":720", "\"width\":1080"), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"height\":1280", "\"height\":1920"), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"fps\":30", "\"fps\":24"), assets)
    }
  }

  @Test
  fun `parses a typescript-valid avatar caption plan`() {
    val avatarAssets = mapOf(
      "avatar-1" to ProductionInput("avatar-1", "/private/avatar-1.mp4", ProductionAssetKind.VIDEO, durationMs = 15_000L, hasAudio = true),
    )

    val plan = ProductionPlanParser.parse(avatarPlan(), avatarAssets, ProductionRenderMode.AVATAR)

    assertEquals(ProductionRenderMode.AVATAR, plan.renderMode)
    assertEquals(720, plan.width)
    assertEquals(1280, plan.height)
    assertEquals(30, plan.fps)
    assertEquals(3, plan.shots.size)
    assertEquals(15_000L, plan.shots.sumOf(ProductionShot::durationMs))
    assertEquals("avatar-1", plan.shots.first().input.id)
    assertEquals("门店介绍", plan.textOverlay.primaryText)
    assertEquals("classic_top", plan.textOverlay.preset)
  }

  @Test
  fun `parses a v3 plan with timed captions and bounded decorations`() {
    val plan = ProductionPlanParser.parse(timedPlan(), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())

    assertEquals("classic_line", plan.subtitleTemplate?.id)
    assertEquals(listOf(2, 1), plan.shots.map { it.cues.size })
    assertEquals(4_000L, plan.shots.first().cues.first().endMs)
    assertEquals(listOf("真实"), plan.shots.first().cues.first().emphasisWords)
    assertEquals(1, plan.decorations.size)
    assertEquals("top_right", plan.decorations.first().anchor)
  }

  @Test
  fun `keeps older plans on the static caption path`() {
    val plan = ProductionPlanParser.parse(validPlan(), assets)

    assertNull(plan.subtitleTemplate)
    assertEquals(emptyList<SubtitleCue>(), plan.shots.first().cues)
    assertEquals(emptyList<ProductionDecorationSpec>(), plan.decorations)
  }

  @Test
  fun `pairs a subtitle template with a v3 plan and nothing else`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan(), assets)
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan(), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan(), assets, ProductionRenderMode.MONTAGE, classicLineTemplate().replace("classic_line", "variety_card"))
    }
  }

  @Test
  fun `rejects captions that overlap, outlive their shot or emphasise absent words`() {
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan().replace("\"startMs\":4000", "\"startMs\":3000"), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan().replace("\"endMs\":8000", "\"endMs\":9000"), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan().replace("[\"真实\"]", "[\"促销\"]"), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
  }

  @Test
  fun `refuses a karaoke template when a cue has no word timings`() {
    val karaoke = classicLineTemplate()
      .replace("\"wordReveal\":\"none\"", "\"wordReveal\":\"karaoke\"")
      .replace("\"pendingFill\":null", "\"pendingFill\":{\"hex\":\"#8fb3ab\",\"opacity\":0.75}")

    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(timedPlan(), assets, ProductionRenderMode.MONTAGE, karaoke)
    }
  }

  @Test
  fun `refuses a sticker decoration while the bundled catalogue is absent`() {
    val sticker = timedPlan().replace(
      "{\"kind\":\"floating_text\",\"assetRef\":null,\"text\":\"限时\"",
      "{\"kind\":\"sticker\",\"assetRef\":\"spark_burst\",\"text\":null",
    )

    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(sticker, assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
  }

  private fun timedPlan(): String = """
    {
      "schemaVersion":"production-plan.v3",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店真实体验",
      "settings":{"width":720,"height":1280,"fps":30,"durationSeconds":20},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "textOverlay":{"primaryText":"看得见的真实服务","secondaryText":"先看环境，再看过程","preset":"aqua_accent"},
      "subtitle":{"templateId":"classic_line"},
      "shots":[
        {"order":1,"assetId":"image-1","durationSeconds":8,"narration":"先看环境。","caption":"真实环境","fit":"cover","cues":[
          {"startMs":0,"endMs":4000,"text":"先看真实环境","emphasisWords":["真实"],"words":null},
          {"startMs":4000,"endMs":8000,"text":"看得见的过程","emphasisWords":[],"words":null}
        ]},
        {"order":2,"assetId":"video-1","durationSeconds":12,"narration":"再看服务。","caption":"服务过程","fit":"contain","cues":[
          {"startMs":0,"endMs":12000,"text":"服务过程全程可看","emphasisWords":[],"words":null}
        ]}
      ],
      "decorations":[
        {"kind":"floating_text","assetRef":null,"text":"限时","shotOrder":1,"startMs":1000,"endMs":3000,"anchor":"top_right","scale":1,"animation":"fade"}
      ]
    }
  """.trimIndent()

  private fun classicLineTemplate(): String = """
    {
      "id":"classic_line",
      "typography":{"fontSizePx":46,"lineHeight":1.25,"fontWeight":700,"letterSpacingPx":0.5,"maxLines":2,"maxCharsPerLine":14},
      "layout":{"align":"center","bottomOffsetPx":260,"insetPx":48},
      "fill":{"hex":"#ffffff","opacity":1},
      "stroke":{"color":{"hex":"#001815","opacity":0.9},"widthPx":6},
      "box":null,
      "entrance":{"kind":"fade","durationMs":180,"easing":"standard","travelPx":0},
      "wordReveal":"none",
      "pendingFill":null,
      "emphasis":{"kind":"recolor","color":{"hex":"#64f4da","opacity":1},"peakScale":1,"durationMs":0,"easing":"standard"}
    }
  """.trimIndent()

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
      "schemaVersion":"production-plan.v2",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店介绍",
      "settings":{"width":720,"height":1280,"fps":30,"durationSeconds":15},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "textOverlay":{"primaryText":"门店介绍","secondaryText":null,"preset":"classic_top"},
      "shots":[
        {"order":1,"assetId":"avatar-1","durationSeconds":5,"narration":"欢迎来到我们的门店。","caption":"欢迎来到我们的门店。","fit":"contain"},
        {"order":2,"assetId":"avatar-1","durationSeconds":5,"narration":"今天带你看看真实服务过程。","caption":"今天带你看看真实服务过程。","fit":"contain"},
        {"order":3,"assetId":"avatar-1","durationSeconds":5,"narration":"欢迎安心了解。","caption":"欢迎安心了解。","fit":"contain"}
      ]
    }
  """.trimIndent()
}
