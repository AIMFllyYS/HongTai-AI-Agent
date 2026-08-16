package com.hongtai.aiagent.production

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
)

/** Strict parser for the small, versioned TypeScript-to-Kotlin render contract. */
internal object ProductionPlanParser {
  fun parse(
    json: String,
    assets: Map<String, ProductionInput>,
    renderMode: ProductionRenderMode = ProductionRenderMode.MONTAGE,
  ): NativeProductionPlan {
    require(json.toByteArray(Charsets.UTF_8).size <= MAX_PLAN_BYTES) { "The production plan is too large." }
    val root = JSONObject(json)
    val schemaVersion = root.getString("schemaVersion")
    require(schemaVersion == "production-plan.v1" || schemaVersion == "production-plan.v2") { "Unsupported production plan version." }
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
      ProductionShot(order, input, shotDurationMs, narration, caption, fit)
    }
    require(shots.sumOf(ProductionShot::durationMs) == durationMs) { "Production shot durations do not match the total duration." }
    val textOverlay = if (schemaVersion == "production-plan.v2") {
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
    return NativeProductionPlan(width, height, fps, durationMs, locale, speechRate, music, musicVolume, shots, textOverlay, renderMode)
  }

  private fun secondsToMs(value: Double): Long {
    require(value.isFinite() && value * 1_000.0 % 1.0 == 0.0) { "Production duration must use millisecond precision." }
    return (value * 1_000.0).toLong()
  }

  private const val MAX_PLAN_BYTES = 128 * 1024
}
