package com.hongtai.aiagent.production

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleOverlayGeometryTest {
  private val frameWidth = 720
  private val frameHeight = 1280

  @Test
  fun `pins a centred caption bottom to the template offset above the platform band`() {
    val transform = SubtitleOverlayGeometry.captionTransform(template(), frameWidth, frameHeight, 1f)

    assertEquals(0f, transform.backgroundAnchorX, 0.001f)
    // 260px above a 1280px frame bottom lands at -1 + 2 * 260 / 1280.
    assertEquals(-0.594f, transform.backgroundAnchorY, 0.001f)
    assertEquals(0f, transform.overlayAnchorX, 0.001f)
    assertEquals(-1f, transform.overlayAnchorY, 0.001f)
    assertEquals(1f, transform.alphaScale, 0.001f)
    assertEquals(1f, transform.scale, 0.001f)
  }

  @Test
  fun `insets a left aligned caption and anchors it to its own left edge`() {
    val transform = SubtitleOverlayGeometry.captionTransform(template(align = "left"), frameWidth, frameHeight, 1f)

    assertEquals(-0.867f, transform.backgroundAnchorX, 0.001f)
    assertEquals(-1f, transform.overlayAnchorX, 0.001f)
  }

  @Test
  fun `slides a caption up into place and lands it on the resting offset`() {
    val sliding = template(entranceKind = "slide_up")
    val resting = SubtitleOverlayGeometry.captionTransform(sliding, frameWidth, frameHeight, 1f)
    val starting = SubtitleOverlayGeometry.captionTransform(sliding, frameWidth, frameHeight, 0f)

    assertTrue(starting.backgroundAnchorY < resting.backgroundAnchorY)
    assertEquals(0f, starting.alphaScale, 0.001f)
    assertEquals(-0.594f, resting.backgroundAnchorY, 0.001f)
  }

  @Test
  fun `starts a pop entrance below full size and never leaves the caption invisible`() {
    val popping = template(entranceKind = "pop")
    val starting = SubtitleOverlayGeometry.captionTransform(popping, frameWidth, frameHeight, 0f)
    val settled = SubtitleOverlayGeometry.captionTransform(popping, frameWidth, frameHeight, 1f)

    assertEquals(0.86f, starting.scale, 0.001f)
    assertEquals(1f, settled.scale, 0.001f)
    assertEquals(1f, settled.alphaScale, 0.001f)
  }

  @Test
  fun `keeps a static template fully visible on its first frame`() {
    val transform = SubtitleOverlayGeometry.captionTransform(template(), frameWidth, frameHeight, 0f)

    assertEquals(1f, transform.alphaScale, 0.001f)
    assertEquals(1f, transform.scale, 0.001f)
  }

  @Test
  fun `places decorations on their side of the frame and above the caption band`() {
    val topRight = SubtitleOverlayGeometry
      .decorationTransform(decoration("top_right"), 260f, frameWidth, frameHeight, 1f)
    val topLeft = SubtitleOverlayGeometry
      .decorationTransform(decoration("top_left"), 260f, frameWidth, frameHeight, 1f)
    val aboveCaption = SubtitleOverlayGeometry
      .decorationTransform(decoration("above_caption"), 260f, frameWidth, frameHeight, 1f)

    assertEquals(0.867f, topRight.backgroundAnchorX, 0.001f)
    assertEquals(1f, topRight.overlayAnchorX, 0.001f)
    assertEquals(-0.867f, topLeft.backgroundAnchorX, 0.001f)
    assertEquals(-1f, topLeft.overlayAnchorX, 0.001f)
    // 260px caption offset plus the 96px gap keeps a decoration clear of the caption.
    assertEquals(-0.444f, aboveCaption.backgroundAnchorY, 0.001f)
    assertTrue(topRight.backgroundAnchorY > 0f)
  }

  @Test
  fun `scales a decoration by its own factor and fades it in over a lead-in`() {
    val faded = SubtitleOverlayGeometry
      .decorationTransform(decoration("middle_left", scale = 1.5f, animation = "fade"), 260f, frameWidth, frameHeight, 0f)
    val visible = SubtitleOverlayGeometry
      .decorationTransform(decoration("middle_left", scale = 1.5f, animation = "fade"), 260f, frameWidth, frameHeight, 0.5f)

    assertEquals(0f, faded.alphaScale, 0.001f)
    assertEquals(1f, visible.alphaScale, 0.001f)
    assertEquals(1.5f, visible.scale, 0.001f)
    assertEquals(0f, visible.backgroundAnchorY, 0.001f)
  }

  @Test
  fun `bounds a caption by the frame and a decoration by its scaled share of it`() {
    assertEquals(frameWidth, SubtitleOverlayGeometry.captionMaxWidthPx(template(), frameWidth))
    assertEquals(672, SubtitleOverlayGeometry.captionMaxWidthPx(template(align = "left"), frameWidth))
    assertEquals(360, SubtitleOverlayGeometry.decorationMaxWidthPx(decoration("top_left"), frameWidth))
    assertEquals(180, SubtitleOverlayGeometry.decorationMaxWidthPx(decoration("top_left", scale = 2f), frameWidth))
  }

  private fun decoration(
    anchor: String,
    scale: Float = 1f,
    animation: String = "none",
  ) = ProductionDecorationSpec(
    kind = "floating_text",
    assetRef = null,
    text = "限时",
    shotOrder = 1,
    startMs = 0L,
    endMs = 2_000L,
    anchor = anchor,
    scale = scale,
    animation = animation,
  )

  private fun template(align: String = "center", entranceKind: String = "none"): SubtitleTemplateSpec =
    SubtitleRenderSpecParser.parseTemplate(
      JSONObject(
        """
        {
          "id":"classic_line",
          "typography":{"fontSizePx":46,"lineHeight":1.25,"fontWeight":700,"letterSpacingPx":0.5,"maxLines":2,"maxCharsPerLine":14},
          "layout":{"align":"$align","bottomOffsetPx":260,"insetPx":48},
          "fill":{"hex":"#ffffff","opacity":1},
          "stroke":{"color":{"hex":"#001815","opacity":0.9},"widthPx":6},
          "box":null,
          "entrance":{"kind":"$entranceKind","durationMs":260,"easing":"standard","travelPx":24},
          "wordReveal":"none",
          "pendingFill":null,
          "emphasis":{"kind":"none","color":null,"peakScale":1,"durationMs":0,"easing":"standard"}
        }
        """.trimIndent(),
      ),
    )
}
