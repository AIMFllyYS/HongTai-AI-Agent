package com.hongtai.aiagent.production

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Wire contract of the OpenAI-compatible transcription endpoint, kept JVM-only. */
class NarrationTranscriptionProtocolTest {
  @Test
  fun `parses verbose_json word timestamps into whole milliseconds`() {
    val words = NarrationTranscriptionProtocol.parseWords(
      """
        {"text":"真实服务","words":[
          {"word":"真实","start":0.0,"end":0.48},
          {"word":"服务","start":0.48,"end":1.1234}
        ]}
      """.trimIndent(),
    )

    assertEquals(listOf(NarrationTranscribedWord("真实", 0, 480), NarrationTranscribedWord("服务", 480, 1_123)), words)
  }

  @Test
  fun `rejects responses without usable word timestamps`() {
    assertProductionFailure("""{"text":"没有词级时间戳"}""")
    assertProductionFailure("""{"words":[]}""")
    assertProductionFailure("not-json")
    assertProductionFailure("""{"words":[{"word":"真实","start":1.0,"end":0.5}]}""")
    assertProductionFailure("""{"words":[{"word":"","start":0,"end":1}]}""")
    assertProductionFailure("""{"words":[{"word":"真实","start":-1,"end":1}]}""")
  }

  @Test
  fun `writes the expected multipart body for a whisper style upload`() {
    val output = ByteArrayOutputStream()
    val audio = "RIFF-audio-bytes".toByteArray(StandardCharsets.US_ASCII)

    NarrationTranscriptionProtocol.writeMultipartBody(output, "hongtai-asr-boundary", "whisper-large-v3", "narration-s-s-1.wav", ByteArrayInputStream(audio))

    val body = output.toString(StandardCharsets.UTF_8.name())
    assertTrue(body.startsWith("--hongtai-asr-boundary\r\n"))
    assertTrue(body.contains("Content-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-large-v3\r\n"))
    assertTrue(body.contains("Content-Disposition: form-data; name=\"response_format\"\r\n\r\nverbose_json\r\n"))
    assertTrue(body.contains("Content-Disposition: form-data; name=\"timestamp_granularities[]\"\r\n\r\nword\r\n"))
    assertTrue(body.contains("Content-Disposition: form-data; name=\"file\"; filename=\"narration-s-s-1.wav\"\r\n"))
    assertTrue(body.contains("Content-Type: audio/wav\r\n\r\nRIFF-audio-bytes\r\n"))
    assertTrue(body.endsWith("--hongtai-asr-boundary--\r\n"))
  }

  @Test
  fun `refuses multipart filenames that could break the form data framing`() {
    val output = ByteArrayOutputStream()

    assertThrows(IllegalArgumentException::class.java) {
      NarrationTranscriptionProtocol.writeMultipartBody(output, "b", "m", "na\"me.wav", ByteArrayInputStream(ByteArray(0)))
    }
    assertThrows(IllegalArgumentException::class.java) {
      NarrationTranscriptionProtocol.writeMultipartBody(output, "b", "m", "line\nbreak.wav", ByteArrayInputStream(ByteArray(0)))
    }
  }

  @Test
  fun `bounded reads refuse oversized transcription responses`() {
    val oversized = ByteArray(NarrationTranscriptionProtocol.MAX_RESPONSE_BYTES + 1)

    val error = assertThrows(ProductionException::class.java) {
      NarrationTranscriptionProtocol.readUtf8Bounded(ByteArrayInputStream(oversized), NarrationTranscriptionProtocol.MAX_RESPONSE_BYTES)
    }
    assertEquals(ProductionFailureKind.TRANSCRIPTION_FAILED, error.kind)
  }

  @Test
  fun `transcription configuration validates public metadata before any key is read`() {
    val configuration = NarrationTranscriptionConfiguration.from("https://api.example.com/v1/", "whisper-large-v3")
    assertEquals("https://api.example.com/v1/", configuration.baseUrl)
    assertEquals("whisper-large-v3", configuration.model)

    assertThrows(IllegalArgumentException::class.java) {
      NarrationTranscriptionConfiguration.from("http://api.example.com/v1/", "whisper-large-v3")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NarrationTranscriptionConfiguration.from("https://api.example.com/v1/", " ")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NarrationTranscriptionConfiguration.from("https://api.example.com/v1/", "bad\nmodel")
    }
  }

  private fun assertProductionFailure(json: String) {
    val error = assertThrows(ProductionException::class.java) {
      NarrationTranscriptionProtocol.parseWords(json)
    }
    assertEquals(ProductionFailureKind.TRANSCRIPTION_FAILED, error.kind)
  }
}
