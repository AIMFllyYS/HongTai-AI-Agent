package com.hongtai.aiagent.production

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AssetPickerResumePolicyTest {
  @Test
  fun `a live original call must keep waiting for the picker result`() {
    assertFalse(AssetPickerResumePolicy.shouldFailAwaitingPicker(originalCallLive = true))
  }

  @Test
  fun `a dangling original call becomes a recoverable terminal on resume`() {
    assertTrue(AssetPickerResumePolicy.shouldFailAwaitingPicker(originalCallLive = false))
  }
}
