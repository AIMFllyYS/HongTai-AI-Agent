package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class LocalDataPublicMapperTest {
  @Test
  fun `returns public AI metadata without an API key`() {
    val payload = LocalDataPublicMapper.aiConnection(
      LocalAiConnection(
        connectionId = "active",
        baseUrl = "https://example.invalid/v1",
        textModel = "text-model",
        visionModel = null,
        asrModel = null,
        asrTransport = "standard",
        jsonObjectEnabled = true,
        jsonSchemaEnabled = false,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 2L,
      ),
    )

    assertEquals("active", payload["connectionId"])
    assertEquals(true, payload["jsonObjectEnabled"])
    assertFalse(payload.keys.any { it.contains("key", ignoreCase = true) })
  }
}
