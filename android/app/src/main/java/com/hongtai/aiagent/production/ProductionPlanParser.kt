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

/**
 * v4 avatar only: one contiguous slice of the single pre-processed avatar source video, in
 * source-local milliseconds. The shared planner guarantees the windows of a shot sum to that
 * shot's measured duration; Kotlin renders them and never re-decides the mapping.
 */
internal data class ProductionSourceWindow(val startMs: Long, val endMs: Long)

internal data class ProductionShot(
  val order: Int,
  val input: ProductionInput,
  val durationMs: Long,
  val narration: String,
  val caption: String,
  val fit: String,
  /** Timed caption lines; empty on plans older than v3, which burn one static caption instead. */
  val cues: List<SubtitleCue> = emptyList(),
  /** v4 only: the storyboard sentence whose measured TTS audio produced this shot's duration. */
  val sentenceId: String? = null,
  /** v4 avatar only: absent on legacy plans, which keep the sequential-accumulation path. */
  val sourceWindows: List<ProductionSourceWindow> = emptyList(),
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
  /** v1–v3: the declared target the shot sum must equal exactly. v4: the sum of measured shot durations. */
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
   * Hard structural floor for a v4 measured shot. The 60 s ceiling mirrors the shared v4 schema's
   * structural maximum (`MAX_MEASURED_SHOT_MS`); whether a shot or the total is too short/long for
   * the product is a shared-layer soft business rule that is deliberately not mirrored here.
   */
  private fun measuredShotDurationMs(value: JSONObject): Long {
    val durationMs = value.getLong("durationMs")
    require(durationMs in 1..MAX_MEASURED_SHOT_MS) { "A production shot duration is invalid." }
    return durationMs
  }

  /**
   * @param subtitleTemplateJson the `subtitle-template.v1` object the shared TypeScript layer
   *   resolved for this plan. Required by v3 and v4 plans and rejected by older ones, because the
   *   template is the only place a caption's look is decided and Kotlin must not carry a second
   *   copy of it.
   */
  fun parse(
    json: String,
    assets: Map<String, ProductionInput>,
    renderMode: ProductionRenderMode = ProductionRenderMode.MONTAGE,
    subtitleTemplateJson: String? = null,
    stickerExists: (String) -> Boolean = { false },
  ): NativeProductionPlan {
    require(json.toByteArray(Charsets.UTF_8).size <= MAX_PLAN_BYTES) { "The production plan is too large." }
    val root = JSONObject(json)
    val schemaVersion = root.getString("schemaVersion")
    require(schemaVersion in SUPPORTED_SCHEMA_VERSIONS) { "Unsupported production plan version." }
    val measuredShots = schemaVersion == "production-plan.v4"
    val timedCaptions = schemaVersion == "production-plan.v3" || measuredShots
    require(timedCaptions == (subtitleTemplateJson != null)) { "A subtitle template is required by v3 and v4 plans only." }
    val settings = root.getJSONObject("settings")
    val width = settings.getInt("width")
    val height = settings.getInt("height")
    val fps = settings.getInt("fps")
    // v4 carries no target duration: the total is Σ per-shot measured durations, and the 15–60 s
    // soft boundary stays a shared-layer business rule Kotlin must not duplicate.
    val durationMs = if (measuredShots) 0L else secondsToMs(settings.getDouble("durationSeconds"))
    require(width == 720 && height == 1280 && fps == 30) { "Only the fixed portrait export profile is supported." }
    if (!measuredShots) require(durationMs in 15_000L..60_000L) { "The production duration is outside the supported range." }

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
    val seenSentenceIds = mutableSetOf<String>()
    val shots = (0 until jsonShots.length()).map { index ->
      val value = jsonShots.getJSONObject(index)
      val order = value.getInt("order")
      require(order == index + 1) { "Production shot order must be continuous." }
      val input = assets[value.getString("assetId")] ?: throw IllegalArgumentException("A production asset does not exist.")
      require(input.kind != ProductionAssetKind.AUDIO) { "A visual shot cannot use an audio asset." }
      val shotDurationMs = if (measuredShots) measuredShotDurationMs(value) else secondsToMs(value.getDouble("durationSeconds"))
      if (!measuredShots) require(shotDurationMs in 1_000L..20_000L) { "A production shot duration is invalid." }
      val sentenceId = if (measuredShots) {
        val id = value.getString("sentenceId").trim()
        require(id.isNotEmpty() && id.length <= MAX_SENTENCE_ID_LENGTH) { "A production sentence reference is invalid." }
        require(seenSentenceIds.add(id)) { "A production sentence reference is duplicated." }
        id
      } else {
        null
      }
      val narration = value.getString("narration").trim()
      val caption = value.getString("caption").trim()
      val fit = value.getString("fit")
      require(narration.isNotEmpty() && narration.length <= 160) { "A production narration line is invalid." }
      require(caption.isNotEmpty() && caption.length <= 40) { "A production caption is invalid." }
      require(fit == "cover" || fit == "contain") { "A production fit mode is invalid." }
      val sourceWindows = if (measuredShots) parseSourceWindows(value, shotDurationMs) else emptyList()
      val cues = if (timedCaptions) {
        SubtitleRenderSpecParser.parseCues(value.getJSONArray("cues"), shotDurationMs)
      } else {
        emptyList()
      }
      ProductionShot(order, input, shotDurationMs, narration, caption, fit, cues, sentenceId, sourceWindows)
    }
    // v1–v3: the shot sum must match the declared target exactly. v4 has no target to match.
    if (!measuredShots) require(shots.sumOf(ProductionShot::durationMs) == durationMs) { "Production shot durations do not match the total duration." }
    val totalDurationMs = if (measuredShots) shots.sumOf(ProductionShot::durationMs) else durationMs
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
        stickerExists,
      )
    } else {
      emptyList()
    }
    return NativeProductionPlan(
      width, height, fps, totalDurationMs, locale, speechRate, music, musicVolume, shots, textOverlay, renderMode,
      template, decorations,
    )
  }

  /**
   * v4 avatar source windows: optional, so legacy plans without them keep the old render path. When
   * present the windows must sum to the shot's measured duration exactly — the TTS narration track
   * defines the shot length, and any drift would desynchronise audio from video. Bounds mirror the
   * shared v4 schema (non-negative integers, end after start, at most 30 windows per shot).
   */
  private fun parseSourceWindows(value: JSONObject, shotDurationMs: Long): List<ProductionSourceWindow> {
    val windowsJson = value.optJSONArray("sourceWindows") ?: return emptyList()
    require(windowsJson.length() in 1..MAX_SOURCE_WINDOWS_PER_SHOT) { "A production source window list is invalid." }
    val windows = (0 until windowsJson.length()).map { index ->
      val window = windowsJson.getJSONObject(index)
      val startMs = window.getLong("startMs")
      val endMs = window.getLong("endMs")
      require(startMs >= 0 && endMs > startMs) { "A production source window is invalid." }
      ProductionSourceWindow(startMs, endMs)
    }
    require(windows.sumOf { it.endMs - it.startMs } == shotDurationMs) {
      "A production shot's source windows do not cover its measured duration."
    }
    return windows
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
    setOf("production-plan.v1", "production-plan.v2", "production-plan.v3", "production-plan.v4")
  private const val MAX_PLAN_BYTES = 128 * 1024
  private const val MAX_TEMPLATE_BYTES = 8 * 1024

  /** Mirrors the shared v4 schema's structural shot maximum (`MAX_MEASURED_SHOT_MS`, 60 s). */
  private const val MAX_MEASURED_SHOT_MS = 60_000L
  /** Mirrors the shared v4 schema's per-shot window cap (`MAX_SOURCE_WINDOWS_PER_SHOT`). */
  private const val MAX_SOURCE_WINDOWS_PER_SHOT = 30
  private const val MAX_SENTENCE_ID_LENGTH = 128
}
