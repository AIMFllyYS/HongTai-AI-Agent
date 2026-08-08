package com.hongtai.aiagent.network

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class NativeDownloadArtifactSlotTest {
  @Test
  fun `derives fixed private paths for semantic image video and audio slots`() {
    assertEquals("media/images/image-2.bin", NativeDownloadArtifactSlot("image", 2).relativePath)
    assertEquals("media/video.mp4", NativeDownloadArtifactSlot("video").relativePath)
    assertEquals("media/video-source.bin", NativeDownloadArtifactSlot("videoPart").relativePath)
    assertEquals("media/audio-source.bin", NativeDownloadArtifactSlot("audio").relativePath)
  }

  @Test
  fun `rejects page-controlled indices for video and audio slots`() {
    try {
      NativeDownloadArtifactSlot("video", 0)
      fail("video must not accept a caller-selected index")
    } catch (_: IllegalArgumentException) {
      // expected
    }
    try {
      NativeDownloadArtifactSlot("image")
      fail("image needs a bounded semantic index")
    } catch (_: IllegalArgumentException) {
      // expected
    }
  }
}
