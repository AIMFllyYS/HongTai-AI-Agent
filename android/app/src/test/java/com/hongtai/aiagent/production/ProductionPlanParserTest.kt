package com.hongtai.aiagent.production

import org.json.JSONException
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
  fun `joins Capacitor public assets with the catalogue relative path`() {
    assertEquals("public/decorations/arrow_right.png", DecorationAssets.assetManagerPath("arrow_right"))
    assertEquals("public/decorations/star_mark.png", DecorationAssets.assetManagerPath("star_mark"))
  }

  @Test
  fun `refuses a sticker whose packaged PNG is missing`() {
    val sticker = timedPlan().replace(
      "{\"kind\":\"floating_text\",\"assetRef\":null,\"text\":\"限时\"",
      "{\"kind\":\"sticker\",\"assetRef\":\"arrow_right\",\"text\":null",
    )

    val error = assertThrows(ProductionException::class.java) {
      ProductionPlanParser.parse(sticker, assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertEquals("A sticker PNG is missing from the packaged catalogue.", error.message)
    assertEquals(ProductionFailureKind.DECORATION_ASSET_MISSING, error.kind)
  }

  @Test
  fun `parses a sticker when the packaged PNG is present`() {
    val sticker = timedPlan().replace(
      "{\"kind\":\"floating_text\",\"assetRef\":null,\"text\":\"限时\"",
      "{\"kind\":\"sticker\",\"assetRef\":\"arrow_right\",\"text\":null",
    )

    val plan = ProductionPlanParser.parse(
      sticker,
      assets,
      ProductionRenderMode.MONTAGE,
      classicLineTemplate(),
      stickerExists = { it == "arrow_right" },
    )

    assertEquals("sticker", plan.decorations.first().kind)
    assertEquals("arrow_right", plan.decorations.first().assetRef)
    assertEquals("public/decorations/arrow_right.png", DecorationAssets.assetManagerPath(plan.decorations.first().assetRef!!))
  }

  @Test
  fun `accepts millisecond durations that seconds cannot hold exactly and still rejects finer ones`() {
    // 8.005 秒在 IEEE-754 下是 8004.999999999999 毫秒，8.1 秒是 8100.000000000001 毫秒。
    // 两者都是合法的整毫秒时长，共享层允许，渲染器也必须能执行。
    val shifted = validPlan()
      .replace("\"durationSeconds\":8,", "\"durationSeconds\":8.005,")
      .replace("\"durationSeconds\":12,", "\"durationSeconds\":11.995,")
    val plan = ProductionPlanParser.parse(shifted, assets)

    assertEquals(8_005L, plan.shots[0].durationMs)
    assertEquals(11_995L, plan.shots[1].durationMs)
    assertEquals(20_000L, plan.shots.sumOf { it.durationMs })

    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(validPlan().replace("\"durationSeconds\":8,", "\"durationSeconds\":8.0005,"), assets)
    }
  }

  @Test
  fun `parses a v4 measured plan whose shots follow measured sentence audio`() {
    // 7.3 秒总时长低于产品 15 秒软下限：那是共享层业务规则，Kotlin 结构校验不镜像它。
    val plan = ProductionPlanParser.parse(measuredPlan(), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())

    assertEquals(7_300L, plan.durationMs)
    assertEquals(listOf(3_200L, 4_100L), plan.shots.map { it.durationMs })
    assertEquals(listOf("s-1", "s-2"), plan.shots.map { it.sentenceId })
    assertEquals("classic_line", plan.subtitleTemplate?.id)
    assertEquals(listOf(1, 1), plan.shots.map { it.cues.size })
  }

  @Test
  fun `v4 structural validation rejects broken sentence references and durations`() {
    assertThrows(JSONException::class.java) {
      ProductionPlanParser.parse(measuredPlan().replace("\"sentenceId\":\"s-1\",", ""), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(measuredPlan().replace("\"sentenceId\":\"s-2\"", "\"sentenceId\":\"s-1\""), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(measuredPlan().replace("\"durationMs\":3200", "\"durationMs\":0"), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(measuredPlan().replace("\"durationMs\":3200", "\"durationMs\":60001"), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
    // A v4 plan still needs its subtitle template: timing captions are not optional.
    assertThrows(IllegalArgumentException::class.java) {
      ProductionPlanParser.parse(measuredPlan(), assets)
    }
  }

  @Test
  fun `a v4 shot without a measured duration fails the read instead of falling back`() {
    assertThrows(JSONException::class.java) {
      ProductionPlanParser.parse(measuredPlan().replace("\"durationMs\":3200,", ""), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    }
  }

  @Test
  fun `parses a v4 avatar plan with source windows and keeps legacy plans windowless`() {
    val avatarAssets = mapOf(
      "avatar-1" to ProductionInput("avatar-1", "/private/avatar-1.mp4", ProductionAssetKind.VIDEO, durationMs = 10_000L, hasAudio = true),
    )

    val plan = ProductionPlanParser.parse(measuredAvatarWindowPlan(), avatarAssets, ProductionRenderMode.AVATAR, classicLineTemplate())

    // 10 秒源视频配两镜各 8 秒：第一镜 [0,6]+[0,2]，第二镜延续游标 [2,8]+[0,2]。
    assertEquals(listOf(ProductionSourceWindow(0, 6_000), ProductionSourceWindow(0, 2_000)), plan.shots[0].sourceWindows)
    assertEquals(listOf(ProductionSourceWindow(2_000, 8_000), ProductionSourceWindow(0, 2_000)), plan.shots[1].sourceWindows)

    // 没有窗口字段的 v4 计划走旧路径（空窗口），向后兼容。
    val legacy = ProductionPlanParser.parse(measuredPlan(), assets, ProductionRenderMode.MONTAGE, classicLineTemplate())
    assertEquals(emptyList<ProductionSourceWindow>(), legacy.shots.first().sourceWindows)
  }

  @Test
  fun `rejects source windows that break the render contract`() {
    val avatarAssets = mapOf(
      "avatar-1" to ProductionInput("avatar-1", "/private/avatar-1.mp4", ProductionAssetKind.VIDEO, durationMs = 10_000L, hasAudio = true),
    )
    fun parse(json: String) = ProductionPlanParser.parse(json, avatarAssets, ProductionRenderMode.AVATAR, classicLineTemplate())

    // 守恒破坏：第一镜窗口之和 7500 ≠ 实测 8000，音画必然失步。
    assertThrows(IllegalArgumentException::class.java) {
      parse(measuredAvatarWindowPlan().replace("\"endMs\":6000}", "\"endMs\":5500}"))
    }
    // 零长度窗口（endMs 不大于 startMs）。
    assertThrows(IllegalArgumentException::class.java) {
      parse(measuredAvatarWindowPlan().replace("\"startMs\":0,\"endMs\":6000", "\"startMs\":6000,\"endMs\":6000"))
    }
    // 空窗口数组：要么缺省走旧路径，要么至少一窗。
    assertThrows(IllegalArgumentException::class.java) {
      parse(
        measuredAvatarWindowPlan().replace(
          "\"sourceWindows\":[{\"startMs\":0,\"endMs\":6000},{\"startMs\":0,\"endMs\":2000}]",
          "\"sourceWindows\":[]",
        ),
      )
    }
  }

  /** v4: per-shot measured durations, one sentence reference per shot, no total duration target. */
  private fun measuredPlan(): String = """
    {
      "schemaVersion":"production-plan.v4",
      "source":{"analysisTaskId":"task-1"},
      "title":"门店真实体验",
      "settings":{"width":720,"height":1280,"fps":30},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "textOverlay":{"primaryText":"看得见的真实服务","secondaryText":"先看环境，再看过程","preset":"aqua_accent"},
      "subtitle":{"templateId":"classic_line"},
      "shots":[
        {"order":1,"assetId":"image-1","durationMs":3200,"sentenceId":"s-1","narration":"先看环境。","caption":"真实环境","fit":"cover","cues":[
          {"startMs":0,"endMs":3200,"text":"先看真实环境","emphasisWords":[],"words":null}
        ]},
        {"order":2,"assetId":"video-1","durationMs":4100,"sentenceId":"s-2","narration":"再看服务。","caption":"服务过程","fit":"contain","cues":[
          {"startMs":0,"endMs":4100,"text":"服务过程全程可看","emphasisWords":[],"words":null}
        ]}
      ],
      "decorations":[]
    }
  """.trimIndent()

  /**
   * v4 avatar: one pre-processed avatar video whose per-shot picture comes from planned source
   * windows (a 10 s source covering two 8 s shots), mirroring what the shared planner bakes.
   */
  private fun measuredAvatarWindowPlan(): String = """
    {
      "schemaVersion":"production-plan.v4",
      "source":{"analysisTaskId":null},
      "title":"门店真实体验",
      "settings":{"width":720,"height":1280,"fps":30},
      "audio":{"voiceLocale":"zh-CN","speechRate":1,"backgroundMusicAssetId":null,"backgroundMusicVolume":0},
      "textOverlay":{"primaryText":"看得见的真实服务","secondaryText":null,"preset":"aqua_accent"},
      "subtitle":{"templateId":"classic_line"},
      "shots":[
        {"order":1,"assetId":"avatar-1","durationMs":8000,"sentenceId":"s-1","narration":"先看环境。","caption":"真实环境","fit":"cover",
          "sourceWindows":[{"startMs":0,"endMs":6000},{"startMs":0,"endMs":2000}],
          "cues":[{"startMs":0,"endMs":8000,"text":"先看真实环境","emphasisWords":[],"words":null}]},
        {"order":2,"assetId":"avatar-1","durationMs":8000,"sentenceId":"s-2","narration":"再看服务。","caption":"服务过程","fit":"contain",
          "sourceWindows":[{"startMs":2000,"endMs":8000},{"startMs":0,"endMs":2000}],
          "cues":[{"startMs":0,"endMs":8000,"text":"服务过程全程可看","emphasisWords":[],"words":null}]}
      ],
      "decorations":[]
    }
  """.trimIndent()

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
