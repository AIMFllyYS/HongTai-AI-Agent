package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudTtsProtocolTest {
  @Test
  fun `MiMo TTS uses the chat audio protocol with an assistant narration`() {
    val payload = CloudTtsProtocol.miMoPayload(
      model = "mimo-v2.5-tts",
      voice = "冰糖",
      narration = "配音检测完成。",
    )

    assertEquals("mimo-v2.5-tts", payload.getString("model"))
    assertEquals("wav", payload.getJSONObject("audio").getString("format"))
    assertEquals("冰糖", payload.getJSONObject("audio").getString("voice"))
    val messages = payload.getJSONArray("messages")
    assertEquals("user", messages.getJSONObject(0).getString("role"))
    assertEquals("assistant", messages.getJSONObject(1).getString("role"))
    assertEquals("配音检测完成。", messages.getJSONObject(1).getString("content"))
  }

  @Test
  fun `StepFun TTS uses the binary WAV speech endpoint protocol`() {
    val payload = CloudTtsProtocol.stepFunPayload(
      model = "stepaudio-2.5-tts",
      voice = "cixingnansheng",
      narration = "配音检测完成。",
      speechRate = 1.25f,
    )

    assertEquals("stepaudio-2.5-tts", payload.getString("model"))
    assertEquals("cixingnansheng", payload.getString("voice"))
    assertEquals("配音检测完成。", payload.getString("input"))
    assertEquals("wav", payload.getString("response_format"))
    assertEquals(1.25, payload.getDouble("speed"), 0.001)
    assertEquals("自然、清晰的中文视频旁白。", payload.getString("instruction"))
  }
}
