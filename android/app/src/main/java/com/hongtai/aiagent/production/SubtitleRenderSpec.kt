package com.hongtai.aiagent.production

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Kotlin mirror of the `subtitle-template.v1` contract. TypeScript owns every styling decision;
 * this file only parses the parameters it is handed and rejects values it cannot execute.
 */
internal data class SubtitleTypographySpec(
  val fontSizePx: Float,
  val lineHeight: Float,
  val fontWeight: Int,
  val letterSpacingPx: Float,
  val maxLines: Int,
  val maxCharsPerLine: Int,
)

internal data class SubtitleLayoutSpec(val align: String, val bottomOffsetPx: Float, val insetPx: Float)

internal data class SubtitleStrokeSpec(val argb: Int, val widthPx: Float)

internal data class SubtitleBoxSpec(val argb: Int, val paddingXPx: Float, val paddingYPx: Float, val radiusPx: Float)

internal data class SubtitleEntranceSpec(val kind: String, val durationMs: Long, val easing: String, val travelPx: Float)

internal data class SubtitleEmphasisSpec(val kind: String, val argb: Int?, val peakScale: Float, val durationMs: Long, val easing: String)

internal data class SubtitleTemplateSpec(
  val id: String,
  val typography: SubtitleTypographySpec,
  val layout: SubtitleLayoutSpec,
  val fillArgb: Int,
  val stroke: SubtitleStrokeSpec?,
  val box: SubtitleBoxSpec?,
  val entrance: SubtitleEntranceSpec,
  val wordReveal: String,
  val pendingArgb: Int?,
  val emphasis: SubtitleEmphasisSpec,
)

internal data class SubtitleCueWord(val text: String, val startMs: Long, val endMs: Long)

internal data class SubtitleCue(
  val startMs: Long,
  val endMs: Long,
  val text: String,
  val emphasisWords: List<String>,
  val words: List<SubtitleCueWord>?,
)

internal data class ProductionDecorationSpec(
  val kind: String,
  val assetRef: String?,
  val text: String?,
  val shotOrder: Int,
  val startMs: Long,
  val endMs: Long,
  val anchor: String,
  val scale: Float,
  val animation: String,
)

internal object SubtitleRenderSpecParser {
  private val ALIGNMENTS = setOf("left", "center")
  private val EASINGS = setOf("linear", "standard", "emphasized", "overshoot")
  private val ENTRANCES = setOf("none", "fade", "slide_up", "pop")
  private val WORD_REVEALS = setOf("none", "karaoke")
  private val EMPHASES = setOf("none", "recolor", "scale", "bounce")
  private val DECORATION_KINDS = setOf("sticker", "floating_text")
  private val DECORATION_ANCHORS = setOf("top_left", "top_right", "middle_left", "middle_right", "above_caption")
  private val DECORATION_ANIMATIONS = setOf("none", "fade", "pop", "float")
  private val HEX = Regex("^#[0-9a-f]{6}$")

  fun parseTemplate(value: JSONObject): SubtitleTemplateSpec {
    val typography = value.getJSONObject("typography").let {
      SubtitleTypographySpec(
        fontSizePx = bounded(it.getDouble("fontSizePx"), 28.0, 72.0, "subtitle font size"),
        lineHeight = bounded(it.getDouble("lineHeight"), 1.0, 2.0, "subtitle line height"),
        fontWeight = it.getInt("fontWeight").also { weight ->
          require(weight in 400..900) { "The subtitle font weight is invalid." }
        },
        letterSpacingPx = bounded(it.getDouble("letterSpacingPx"), -2.0, 6.0, "subtitle letter spacing"),
        maxLines = it.getInt("maxLines").also { lines -> require(lines in 1..2) { "The subtitle line budget is invalid." } },
        maxCharsPerLine = it.getInt("maxCharsPerLine").also { chars ->
          require(chars in 8..24) { "The subtitle characters per line is invalid." }
        },
      )
    }
    val layout = value.getJSONObject("layout").let {
      val align = it.getString("align")
      require(align in ALIGNMENTS) { "The subtitle alignment is invalid." }
      SubtitleLayoutSpec(
        align = align,
        bottomOffsetPx = bounded(it.getDouble("bottomOffsetPx"), 180.0, 900.0, "subtitle bottom offset"),
        insetPx = bounded(it.getDouble("insetPx"), 16.0, 240.0, "subtitle inset"),
      )
    }
    val stroke = value.optJSONObject("stroke")?.let {
      SubtitleStrokeSpec(argb(it.getJSONObject("color")), bounded(it.getDouble("widthPx"), 1.0, 16.0, "subtitle stroke width"))
    }
    val box = value.optJSONObject("box")?.let {
      SubtitleBoxSpec(
        argb = argb(it.getJSONObject("color")),
        paddingXPx = bounded(it.getDouble("paddingXPx"), 0.0, 96.0, "subtitle box padding"),
        paddingYPx = bounded(it.getDouble("paddingYPx"), 0.0, 64.0, "subtitle box padding"),
        radiusPx = bounded(it.getDouble("radiusPx"), 0.0, 64.0, "subtitle box radius"),
      )
    }
    require(stroke != null || box != null) { "A subtitle template needs a stroke or a box to stay readable." }

    val entrance = value.getJSONObject("entrance").let {
      val kind = it.getString("kind")
      val easing = it.getString("easing")
      require(kind in ENTRANCES) { "The subtitle entrance is invalid." }
      require(easing in EASINGS) { "The subtitle easing is invalid." }
      SubtitleEntranceSpec(
        kind = kind,
        durationMs = bounded(it.getDouble("durationMs"), 0.0, 600.0, "subtitle entrance duration").toLong(),
        easing = easing,
        travelPx = bounded(it.getDouble("travelPx"), 0.0, 80.0, "subtitle entrance travel"),
      )
    }
    val emphasis = value.getJSONObject("emphasis").let {
      val kind = it.getString("kind")
      val easing = it.getString("easing")
      require(kind in EMPHASES) { "The subtitle emphasis is invalid." }
      require(easing in EASINGS) { "The subtitle easing is invalid." }
      SubtitleEmphasisSpec(
        kind = kind,
        argb = it.optJSONObject("color")?.let(::argb),
        peakScale = bounded(it.getDouble("peakScale"), 1.0, 1.6, "subtitle emphasis scale"),
        durationMs = bounded(it.getDouble("durationMs"), 0.0, 600.0, "subtitle emphasis duration").toLong(),
        easing = easing,
      )
    }
    val wordReveal = value.getString("wordReveal")
    require(wordReveal in WORD_REVEALS) { "The subtitle word reveal is invalid." }
    val pendingArgb = value.optJSONObject("pendingFill")?.let(::argb)
    require(wordReveal != "karaoke" || pendingArgb != null) { "A karaoke subtitle needs a pending colour." }

    return SubtitleTemplateSpec(
      id = value.getString("id"),
      typography = typography,
      layout = layout,
      fillArgb = argb(value.getJSONObject("fill")),
      stroke = stroke,
      box = box,
      entrance = entrance,
      wordReveal = wordReveal,
      pendingArgb = pendingArgb,
      emphasis = emphasis,
    )
  }

  fun parseCues(array: JSONArray, shotDurationMs: Long): List<SubtitleCue> {
    require(array.length() in 1..12) { "The subtitle cue count is outside the supported range." }
    var previousEndMs = -1L
    return (0 until array.length()).map { index ->
      val value = array.getJSONObject(index)
      val startMs = value.getLong("startMs")
      val endMs = value.getLong("endMs")
      val cueText = value.getString("text").trim()
      require(endMs > startMs) { "A subtitle cue needs a positive range." }
      require(startMs >= previousEndMs) { "Subtitle cues cannot overlap." }
      require(endMs <= shotDurationMs + CUE_TAIL_TOLERANCE_MS) { "A subtitle cue outlives its shot." }
      require(cueText.isNotEmpty() && cueText.length <= 40) { "A subtitle cue text is invalid." }
      previousEndMs = endMs
      val emphasisWords = value.getJSONArray("emphasisWords").let { words ->
        require(words.length() <= 3) { "A subtitle cue has too many emphasis words." }
        (0 until words.length()).map { position ->
          words.getString(position).also { word -> require(cueText.contains(word)) { "An emphasis word is not in its cue." } }
        }
      }
      SubtitleCue(startMs, endMs, cueText, emphasisWords, parseWords(value.optJSONArray("words"), startMs, endMs, cueText))
    }
  }

  private fun parseWords(array: JSONArray?, cueStartMs: Long, cueEndMs: Long, cueText: String): List<SubtitleCueWord>? {
    if (array == null || array.length() == 0) return null
    require(array.length() <= 40) { "A subtitle cue has too many word timings." }
    var previousEndMs = cueStartMs
    val words = (0 until array.length()).map { index ->
      val value = array.getJSONObject(index)
      val startMs = value.getLong("startMs")
      val endMs = value.getLong("endMs")
      require(endMs > startMs) { "A subtitle word needs a positive range." }
      require(startMs >= cueStartMs && endMs <= cueEndMs) { "A subtitle word falls outside its cue." }
      require(startMs >= previousEndMs) { "Subtitle words cannot overlap." }
      previousEndMs = endMs
      SubtitleCueWord(value.getString("text"), startMs, endMs)
    }
    require(words.joinToString("") { it.text }.filterNot(Char::isWhitespace) == cueText.filterNot(Char::isWhitespace)) {
      "Subtitle word timings do not spell their cue."
    }
    return words
  }

  fun parseDecorations(array: JSONArray, shotDurations: Map<Int, Long>): List<ProductionDecorationSpec> {
    require(array.length() <= MAX_DECORATIONS_PER_PLAN) { "The decoration count is outside the supported range." }
    val perShot = mutableMapOf<Int, Int>()
    return (0 until array.length()).map { index ->
      val value = array.getJSONObject(index)
      val kind = value.getString("kind")
      val anchor = value.getString("anchor")
      val animation = value.getString("animation")
      val shotOrder = value.getInt("shotOrder")
      val startMs = value.getLong("startMs")
      val endMs = value.getLong("endMs")
      val assetRef = value.optString("assetRef").takeIf { it.isNotBlank() && it != "null" }
      val text = value.optString("text").takeIf { it.isNotBlank() && it != "null" }
      require(kind in DECORATION_KINDS) { "The decoration kind is invalid." }
      require(anchor in DECORATION_ANCHORS) { "The decoration anchor is invalid." }
      require(animation in DECORATION_ANIMATIONS) { "The decoration animation is invalid." }
      val shotDurationMs = shotDurations[shotOrder] ?: throw IllegalArgumentException("A decoration references a missing shot.")
      require(endMs > startMs && endMs <= shotDurationMs + CUE_TAIL_TOLERANCE_MS) { "A decoration outlives its shot." }
      val used = (perShot[shotOrder] ?: 0) + 1
      require(used <= MAX_DECORATIONS_PER_SHOT) { "One shot carries too many decorations." }
      perShot[shotOrder] = used
      if (kind == "sticker") {
        require(assetRef != null && text == null) { "A sticker decoration needs a catalogue reference and no text." }
        require(BUNDLED_ASSET_REF.matches(assetRef)) { "A sticker reference is not a catalogue id." }
        // The bundled decoration catalogue is not shipped yet, so a sticker cannot be resolved to
        // real pixels. Failing here keeps a plan from exporting with its stickers silently missing.
        throw IllegalArgumentException("The bundled sticker catalogue is not available in this build.")
      } else {
        require(text != null && assetRef == null) { "A floating text decoration needs text and no catalogue reference." }
        require(text.length <= 12) { "A floating text decoration is too long." }
      }
      ProductionDecorationSpec(
        kind, assetRef, text, shotOrder, startMs, endMs, anchor,
        bounded(value.getDouble("scale"), 0.5, 2.0, "decoration scale"), animation,
      )
    }
  }

  private fun argb(value: JSONObject): Int {
    val hex = value.getString("hex")
    require(HEX.matches(hex)) { "A subtitle colour must be lowercase #rrggbb." }
    val opacity = value.getDouble("opacity")
    require(opacity in 0.0..1.0) { "A subtitle colour opacity is invalid." }
    val alpha = (opacity * 255.0).roundToInt().coerceIn(0, 255)
    return (alpha shl 24) or hex.substring(1).toInt(16)
  }

  private fun bounded(value: Double, minimum: Double, maximum: Double, label: String): Float {
    require(value.isFinite() && value >= minimum && value <= maximum) { "The $label is outside the supported range." }
    return value.toFloat()
  }

  /** A cue or decoration may finish this many milliseconds past its shot to absorb rounding. */
  const val CUE_TAIL_TOLERANCE_MS = 60L
  const val MAX_DECORATIONS_PER_SHOT = 2
  const val MAX_DECORATIONS_PER_PLAN = 6
  private val BUNDLED_ASSET_REF = Regex("^[a-z0-9][a-z0-9_-]{0,47}$")
}
