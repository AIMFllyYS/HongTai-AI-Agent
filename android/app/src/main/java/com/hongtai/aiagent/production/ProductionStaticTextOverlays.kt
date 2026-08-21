package com.hongtai.aiagent.production

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.effect.TextureOverlay

/**
 * v1/v2 burned-in title and static caption. v3 plans use [ProductionCaptionOverlay] instead;
 * these remain so a re-export of an older project looks unchanged.
 */
@UnstableApi
internal fun headlineOverlays(value: ProductionTextOverlay): List<TextureOverlay> {
  if (value.primaryText.isBlank()) return emptyList()
  val combined = listOfNotNull(value.primaryText, value.secondaryText).joinToString("\n")
  val secondaryStart = value.secondaryText?.let { value.primaryText.length + 1 }
  fun styledText(foreground: Int, background: Int?): SpannableString = SpannableString(combined).apply {
    setSpan(ForegroundColorSpan(foreground), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    background?.let { setSpan(BackgroundColorSpan(it), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(AbsoluteSizeSpan(54), 0, secondaryStart ?: length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    secondaryStart?.let { setSpan(AbsoluteSizeSpan(34), it, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
  }
  val mainSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, 0.72f).setOverlayFrameAnchor(0f, 0f).build()
  return when (value.preset) {
    "clean_card" -> listOf(TextOverlay.createStaticTextOverlay(styledText(Color.rgb(18, 34, 31), Color.argb(224, 255, 255, 255)), mainSettings))
    "aqua_accent" -> listOf(TextOverlay.createStaticTextOverlay(styledText(Color.rgb(100, 244, 218), Color.argb(205, 0, 37, 34)), mainSettings))
    else -> {
      val shadowSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0.014f, 0.706f).setOverlayFrameAnchor(0f, 0f).build()
      listOf(
        TextOverlay.createStaticTextOverlay(styledText(Color.argb(225, 0, 0, 0), null), shadowSettings),
        TextOverlay.createStaticTextOverlay(styledText(Color.WHITE, null), mainSettings),
      )
    }
  }
}

@UnstableApi
internal fun captionOverlays(value: String): List<TextureOverlay> {
  val shadow = SpannableString("  ▌  $value  ").apply {
    setSpan(ForegroundColorSpan(Color.argb(210, 0, 0, 0)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(BackgroundColorSpan(Color.argb(220, 0, 24, 21)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(AbsoluteSizeSpan(42), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }
  val foreground = SpannableString("  ▌  $value  ").apply {
    setSpan(ForegroundColorSpan(Color.WHITE), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(ForegroundColorSpan(Color.rgb(126, 189, 172)), 2, 3, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(BackgroundColorSpan(Color.argb(196, 0, 48, 42)), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    setSpan(AbsoluteSizeSpan(42), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }
  val shadowSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0.012f, -0.708f).setOverlayFrameAnchor(0f, 0f).build()
  val foregroundSettings = StaticOverlaySettings.Builder().setBackgroundFrameAnchor(0f, -0.72f).setOverlayFrameAnchor(0f, 0f).build()
  return listOf(
    TextOverlay.createStaticTextOverlay(shadow, shadowSettings),
    TextOverlay.createStaticTextOverlay(foreground, foregroundSettings),
  )
}
