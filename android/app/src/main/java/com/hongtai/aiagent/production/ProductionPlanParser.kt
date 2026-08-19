package com.hongtai.aiagent.production

import kotlin.math.abs
import org.json.JSONObject

internal enum class ProductionAssetKind { IMAGE, VIDEO, AUDIO }
internal enum class ProductionRenderMode { MONTAGE, AVATAR }

internal data class ProductionInput(
  val id: String,
  val path: String,
  val kind: ProductionAssetKind,
  val durationMs: Long? = null,
  val hasAudio: Boolean = false,
)

internal data class ProductionShot(
  val order: Int,
  val input: ProductionInput,
  val durationMs: Long,
  val narration: String,
  val caption: String,
  val fit: String,
  /** Timed caption lines; empty on plans older than v3, which burn one static caption instead. */
  val cues: List<SubtitleCue> = emptyList(),
)

internal data class ProductionTextOverlay(
  val primaryText: String,
  val secondaryText: String?,
  val preset: String,
)

internal data class NativeProductionPlan(
  val width: Int,
  val height: Int,
  val fps: Int,
  val durationMs: Long,
  val voiceLocale: String,
  val speechRate: Float,
  val backgroundMusic: ProductionInput?,
  val backgroundMusicVolume: Float,
  val shots: List<ProductionShot>,
  val textOverlay: ProductionTextOverlay = ProductionTextOverlay("", null, "classic_top"),
  val renderMode: ProductionRenderMode = ProductionRenderMode.MONTAGE,
  /** Resolved subtitle template for v3 plans; null keeps the legacy static caption path. */
  val subtitleTemplate: SubtitleTemplateSpec? = null,
  val decorations: List<ProductionDecorationSpec> = emptyList(),
)

/** Strict parser for the small, versioned TypeScript-to-Kotlin render contract. */
internal object ProductionPlanParser {
  /**
   * @param subtitleTemplateJson the `subtitle-template.v1` object the shared TypeScript layer
   *   resolved for this plan. Required by v3 plans and rejected by older ones, because the template
   *   is the only place a caption's look is decided and Kotlin must not carry a second copy of it.
   */
  fun parse(
    json: String,
    assets: Map<String, ProductionInput>,
    renderMode: ProductionRenderMode = ProductionRenderMode.MONTAGE,
    subtitleTemplateJson: String? = null,
  ): NativeProductionPlan {
    require(json.toByteArray(Charsets.UTF_8).size <= MAX_PLAN_BYTES) { "The production plan is too large." }
    val root = JSONObject(json)
    val schemaVersion = root.getString("schemaVersion")
    require(schemaVersion in SUPPORTED_SCHEMA_VERSIONS) { "Unsupported production plan version." }
    val timedCaptions = schemaVersion == "production-plan.v3"
    require(timedCaptions == (subtitleTemplateJson != null)) { "A subtitle template is required by v3 plans only." }
    val settings = root.getJSONObject("settings")
    val width = settings.getInt("width")
    val height = settings.getInt("height")
    val fps = settings.getInt("fps")
    val durationMs = secondsToMs(settings.getDouble("durationSeconds"))
    require(width == 720 && height == 1280 && fps == 30) { "Only the fixed portrait export profile is supported." }
    require(durationMs in 15_000L..60_000L) { "The production duration is outside the supported range." }

    val audio = root.getJSONObject("audio")
    val locale = audio.getString("voiceLocale")
    val speechRate = audio.getDouble("speechRate").toFloat()
    val musicId = audio.optString("backgroundMusicAssetId").takeIf { it.isNotBlank() && it != "null" }
    val music = musicId?.let { assets[it] ?: throw IllegalArgumentException("The background music asset does not exist.") }
    val musicVolume = audio.getDouble("backgroundMusicVolume").toFloat()
    require(locale == "zh-CN" && speechRate in 0.75f..1.25f) { "The production voice settings are invalid." }
    require(music == null || music.kind == ProductionAssetKind.AUDIO) { "Background music must be an audio asset." }
    require(musicVolume in 0f..0.35f && (music != null || musicVolume == 0f)) { "The background music volume is invalid." }

    val jsonShots = root.getJSONArray("shots")
    require(jsonShots.length() in 1..12) { "The production shot count is outside the supported range." }
    val shots = (0 until jsonShots.length()).map { index ->
      val value = jsonShots.getJSONObject(index)
      val order = value.getInt("order")
      require(order == index + 1) { "Production shot order must be continuous." }
      val input = assets[value.getString("assetId")] ?: throw IllegalArgumentException("A production asset does not exist.")
      require(input.kind != ProductionAssetKind.AUDIO) { "A visual shot cannot use an audio asset." }
      val shotDurationMs = secondsToMs(value.getDouble("durationSeconds"))
      require(shotDurationMs in 1_000L..20_000L) { "A production shot duration is invalid." }
      val narration = value.getString("narration").trim()
      val caption = value.getString("caption").trim()
      val fit = value.getString("fit")
      require(narration.isNotEmpty() && narration.length <= 160) { "A production narration line is invalid." }
      require(caption.isNotEmpty() && caption.length <= 40) { "A production caption is invalid." }
      require(fit == "cover" || fit == "contain") { "A production fit mode is invalid." }
      val cues = if (timedCaptions) {
        SubtitleRenderSpecParser.parseCues(value.getJSONArray("cues"), shotDurationMs)
      } else {
        emptyList()
      }
      ProductionShot(order, input, shotDurationMs, narration, caption, fit, cues)
    }
    require(shots.sumOf(ProductionShot::durationMs) == durationMs) { "Production shot durations do not match the total duration." }
    val textOverlay = if (schemaVersion != "production-plan.v1") {
      val value = root.getJSONObject("textOverlay")
      val primaryText = value.getString("primaryText").trim()
      val secondaryText = value.optString("secondaryText").trim().takeIf { it.isNotEmpty() && it != "null" }
      val preset = value.getString("preset")
      require(primaryText.isNotEmpty() && primaryText.length <= 24) { "The production primary text is invalid." }
      require(secondaryText == null || secondaryText.length <= 32) { "The production secondary text is invalid." }
      require(preset in setOf("classic_top", "clean_card", "aqua_accent")) { "The production text preset is invalid." }
      ProductionTextOverlay(primaryText, secondaryText, preset)
    } else {
      ProductionTextOverlay(root.getString("title").trim().take(24), null, "classic_top")
    }
    val template = subtitleTemplateJson?.let { parseSubtitleTemplate(it, root, shots) }
    val decorations = if (timedCaptions) {
      SubtitleRenderSpecParser.parseDecorations(
        root.getJSONArray("decorations"),
        shots.associate { it.order to it.durationMs },
      )
    } else {
      emptyList()
    }
    return NativeProductionPlan(
      width, height, fps, durationMs, locale, speechRate, music, musicVolume, shots, textOverlay, renderMode,
      template, decorations,
    )
  }

  private fun parseSubtitleTemplate(json: String, root: JSONObject, shots: List<ProductionShot>): SubtitleTemplateSpec {
    require(json.toByteArray(Charsets.UTF_8).size <= MAX_TEMPLATE_BYTES) { "The subtitle template is too large." }
    val template = SubtitleRenderSpecParser.parseTemplate(JSONObject(json))
    require(template.id == root.getJSONObject("subtitle").getString("templateId")) {
      "The subtitle template does not match the plan."
    }
    // A karaoke sweep without word timings would have to guess which word is being spoken, so the
    // shared layer degrades the template instead. Reaching here means that contract was broken.
    require(template.wordReveal != "karaoke" || shots.all { shot -> shot.cues.all { it.words != null } }) {
      "A karaoke subtitle template needs word level timings on every cue."
    }
    return template
  }

  private fun secondsToMs(value: Double): Long {
    require(value.isFinite()) { "Production duration must be a finite number of seconds." }
    val milliseconds = value * 1_000.0
    val rounded = Math.round(milliseconds)
    // Seconds cannot hold every millisecond exactly in binary floating point: 8.1 seconds becomes
    // 8100.000000000001 ms. An exact remainder check would reject durations the shared layer
    // considers valid, and truncating would lose a millisecond, so mirror the shared tolerance.
    require(abs(milliseconds - rounded) < 1e-6) { "Production duration must use millisecond precision." }
    return rounded
  }

  private val SUPPORTED_SCHEMA_VERSIONS =
    setOf("production-plan.v1", "production-plan.v2", "production-plan.v3")
  private const val MAX_PLAN_BYTES = 128 * 1024
  private const val MAX_TEMPLATE_BYTES = 8 * 1024
}
