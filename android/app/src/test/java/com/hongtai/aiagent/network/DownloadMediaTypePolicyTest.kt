package com.hongtai.aiagent.network

import org.junit.Assert.assertThrows
import org.junit.Test

class DownloadMediaTypePolicyTest {
  @Test
  fun `accepts bilibili dash audio advertised as video mp4`() {
    DownloadMediaTypePolicy.requireExpectedMediaType("audio", "video/mp4")
    DownloadMediaTypePolicy.requireExpectedMediaType("audio", "audio/mp4")
    DownloadMediaTypePolicy.requireExpectedMediaType("audio", "application/octet-stream")
    DownloadMediaTypePolicy.requireExpectedMediaType("audio", null)
  }

  @Test
  fun `still rejects html json and hls for every slot`() {
    for (kind in listOf("image", "video", "videoPart", "audio")) {
      assertThrows(NativeNetworkException::class.java) {
        DownloadMediaTypePolicy.requireExpectedMediaType(kind, "text/html")
      }
      assertThrows(NativeNetworkException::class.java) {
        DownloadMediaTypePolicy.requireExpectedMediaType(kind, "application/json")
      }
      assertThrows(NativeNetworkException::class.java) {
        DownloadMediaTypePolicy.requireExpectedMediaType(kind, "application/vnd.apple.mpegurl")
      }
    }
  }

  @Test
  fun `rejects a video type that is not iso bmff for the audio slot`() {
    assertThrows(NativeNetworkException::class.java) {
      DownloadMediaTypePolicy.requireExpectedMediaType("audio", "video/webm")
    }
    assertThrows(NativeNetworkException::class.java) {
      DownloadMediaTypePolicy.requireExpectedMediaType("image", "video/mp4")
    }
  }
}
