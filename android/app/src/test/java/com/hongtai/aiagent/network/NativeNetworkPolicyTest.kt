package com.hongtai.aiagent.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeNetworkPolicyTest {
  @Test
  fun `resolves an AI path only beneath the configured HTTPS base URL`() {
    assertEquals(
      "https://ai.example.test/v1/chat/completions",
      NativeNetworkPolicy.resolveAiEndpoint(
        baseUrl = "https://ai.example.test/v1/",
        relativePath = "chat/completions",
      ).toString(),
    )
  }

  @Test
  fun `rejects unsafe download and AI endpoint URLs`() {
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireHttpsUrl("http://example.test/video.mp4", "download source")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.resolveAiEndpoint("https://ai.example.test/v1", "https://other.test/chat/completions")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.resolveAiEndpoint("https://ai.example.test/v1", "../admin")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.resolveAiEndpoint("https://ai.example.test/v1", "chat/completions?token=unsafe")
    }
  }

  @Test
  fun `rejects private network targets before a native request can connect`() {
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requirePublicNetworkTarget(
        NativeNetworkPolicy.requireHttpsUrl("https://127.0.0.1/private", "download source"),
        "download source",
      )
    }
  }

  @Test
  fun `allows HTTPS domain names without resolving proxy fake IP addresses`() {
    val target = NativeNetworkPolicy.requireHttpsUrl(
      "https://provider-that-does-not-resolve.invalid/v1/chat/completions",
      "AI endpoint",
    )

    assertEquals(target, NativeNetworkPolicy.requirePublicNetworkTarget(target, "AI endpoint"))
  }

  @Test
  fun `still rejects local and benchmark addresses when entered as literals`() {
    for (value in listOf(
      "https://127.0.0.1/private",
      "https://10.0.0.1/private",
      "https://192.168.1.1/private",
      "https://198.18.1.108/private",
      "https://[fc00::1]/private",
    )) {
      assertThrows(IllegalArgumentException::class.java) {
        NativeNetworkPolicy.requirePublicNetworkTarget(
          NativeNetworkPolicy.requireHttpsUrl(value, "download source"),
          "download source",
        )
      }
    }
  }

  @Test
  fun `allows only non-credential download headers`() {
    assertEquals(
      mapOf("accept" to "video/*", "user-agent" to "HongTai/1.0"),
      NativeNetworkPolicy.sanitizeDownloadHeaders(
        mapOf("Accept" to "video/*", "User-Agent" to "HongTai/1.0"),
      ),
    )
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.sanitizeDownloadHeaders(mapOf("Authorization" to "Bearer secret"))
    }
  }

  @Test
  fun `rejects credential and hop by hop AI headers`() {
    assertEquals(
      mapOf("content-type" to "application/json"),
      NativeNetworkPolicy.sanitizeAiHeaders(mapOf("Content-Type" to "application/json")),
    )
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.sanitizeAiHeaders(mapOf("X-Api-Key" to "secret"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.sanitizeAiHeaders(mapOf("Host" to "provider.example"))
    }
  }

  @Test
  fun `rejects credential-shaped AI JSON fields and multipart field names at the native boundary`() {
    NativeNetworkPolicy.requireCredentialFreeAiJson(
      """{"model":"demo","metadata":{"host":"provider metadata only","content-length":42},"messages":[{"role":"user","content":"hello"}]}""",
    )

    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireCredentialFreeAiJson(
        """{"messages":[{"content":{"access_token":"must-not-leave-the-device"}}]}""",
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireCredentialFreeAiJson("""{"api_key":"must-not-leave-the-device"}""")
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireCredentialFreeAiMultipartField("X-Api-Key")
    }
  }

  @Test
  fun `allows only bounded JSON POST headers for platform page fetches`() {
    assertEquals(
      mapOf(
        "content-type" to "application/json; charset=utf-8",
        "origin" to "https://www.kuaishou.com",
        "referer" to "https://www.kuaishou.com/",
      ),
      NativeNetworkPolicy.sanitizeFetchHeaders(
        mapOf(
          "Content-Type" to "application/json; charset=utf-8",
          "Origin" to "https://www.kuaishou.com",
          "Referer" to "https://www.kuaishou.com/",
        ),
      ),
    )
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireFetchRequest("POST", "{\"operationName\":\"feed\"}", emptyMap())
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.requireFetchRequest(
        "POST",
        "{\"operationName\":\"feed\"}",
        mapOf("content-type" to "application/jsonx"),
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeNetworkPolicy.sanitizeFetchHeaders(mapOf("Cookie" to "session=secret"))
    }
  }

  @Test
  fun `maps only a semantic image slot to a fixed task-private download path`() {
    assertEquals("media/images/image-3.bin", NativeDownloadArtifactSlot("image", 3).relativePath)
    assertEquals("media/video.mp4", NativeDownloadArtifactSlot("video").relativePath)
    assertEquals("media/video-source.bin", NativeDownloadArtifactSlot("videoPart").relativePath)
    assertEquals("media/audio-source.bin", NativeDownloadArtifactSlot("audio").relativePath)
    assertThrows(IllegalArgumentException::class.java) {
      NativeDownloadArtifactSlot("video", 0)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativeDownloadArtifactSlot("image", -1)
    }
  }
}
