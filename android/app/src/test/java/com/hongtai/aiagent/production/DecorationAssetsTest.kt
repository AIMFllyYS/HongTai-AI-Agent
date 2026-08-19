package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Test

class DecorationAssetsTest {
  @Test
  fun `asset manager path is the Capacitor public prefix plus decorations id png`() {
    assertEquals("public/decorations/arrow_right.png", DecorationAssets.assetManagerPath("arrow_right"))
    assertEquals("public/decorations/speech_bubble.png", DecorationAssets.assetManagerPath("speech_bubble"))
    assertEquals("public", DecorationAssets.ASSET_PREFIX)
    assertEquals("decorations", DecorationAssets.RELATIVE_DIR)
  }
}
