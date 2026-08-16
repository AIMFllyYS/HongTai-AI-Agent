package com.hongtai.aiagent.production

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class CloudTtsProtocolTest {
  @Test
  fun `MiMo TTS writes the caller instruction into the user turn as-is`() {
    val payload = CloudTtsProtocol.miMoPayload(
      model = "mimo-v2.5-tts",
      voice = "冰糖",
      narration = "配音检测完成。",
      instruction = "caller-mimo-instruction",
    )

    assertEquals("mimo-v2.5-tts", payload.getString("model"))
    assertEquals("wav", payload.getJSONObject("audio").getString("format"))
    assertEquals("冰糖", payload.getJSONObject("audio").getString("voice"))
    val messages = payload.getJSONArray("messages")
    assertEquals("user", messages.getJSONObject(0).getString("role"))
    assertEquals("caller-mimo-instruction", messages.getJSONObject(0).getString("content"))
    assertEquals("assistant", messages.getJSONObject(1).getString("role"))
    assertEquals("配音检测完成。", messages.getJSONObject(1).getString("content"))
  }

  @Test
  fun `StepFun TTS writes the caller instruction into the vendor body as-is`() {
    val payload = CloudTtsProtocol.stepFunPayload(
      model = "stepaudio-2.5-tts",
      voice = "cixingnansheng",
      narration = "配音检测完成。",
      speechRate = 1.25f,
      instruction = "caller-stepfun-instruction",
    )

    assertEquals("stepaudio-2.5-tts", payload.getString("model"))
    assertEquals("cixingnansheng", payload.getString("voice"))
    assertEquals("配音检测完成。", payload.getString("input"))
    assertEquals("wav", payload.getString("response_format"))
    assertEquals(1.25, payload.getDouble("speed"), 0.001)
    assertEquals("caller-stepfun-instruction", payload.getString("instruction"))
  }

  @Test
  fun `missing or blank TTS instruction fails without a local fallback`() {
    assertThrows(IllegalArgumentException::class.java) { CloudTtsProtocol.requireInstruction(null) }
    assertThrows(IllegalArgumentException::class.java) { CloudTtsProtocol.requireInstruction("") }
    assertThrows(IllegalArgumentException::class.java) { CloudTtsProtocol.requireInstruction("   ") }
    assertEquals("caller-supplied", CloudTtsProtocol.requireInstruction("  caller-supplied  "))
  }

  @Test
  fun `native cloud TTS source no longer embeds instruction prompts`() {
    val source = File("src/main/java/com/hongtai/aiagent/production/CloudNarrationSynthesizer.kt").readText()
    assertFalse(source.contains("请以自然、清晰的普通话播报。"))
    assertFalse(source.contains("自然、清晰的中文视频旁白。"))
  }
}
