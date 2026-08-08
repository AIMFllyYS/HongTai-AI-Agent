package com.hongtai.aiagent.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TaskMediaRuntimePolicyTest {
  @Test
  fun `derives one task owner only from a task media path`() {
    assertEquals(
      "task-42",
      TaskPrivateMediaPolicy.taskIdForRelativeInputPath("tasks/task-42/media/download/source.mp4"),
    )
    assertEquals(
      "task-42",
      TaskPrivateMediaPolicy.taskIdForRelativeInputPath("tasks/task-42/media/pcm/source.wav"),
    )
    assertEquals(null, TaskPrivateMediaPolicy.taskIdForRelativeInputPath("media/imports/source.mp4"))
    assertEquals(null, TaskPrivateMediaPolicy.taskIdForRelativeInputPath("tasks/task-42/state/task.json"))
    assertEquals(null, TaskPrivateMediaPolicy.taskIdForRelativeInputPath("tasks/other/media/../state/task.json"))
    assertEquals(null, TaskPrivateMediaPolicy.taskIdForRelativeInputPath("tasks/task-42/media/remux/output.mp4.part"))
  }

  @Test
  fun `plans frame aligned wav segments within the requested maximum`() {
    val plan = PcmWavSegmentationPolicy.plan(
      sampleRateHz = 16_000,
      channelCount = 1,
      dataBytes = 2_560_000L,
      maxSegmentDurationMs = 30_000,
    )

    assertEquals(3, plan.size)
    assertEquals(960_000L, plan[0].dataBytes)
    assertEquals(960_000L, plan[1].dataBytes)
    assertEquals(640_000L, plan[2].dataBytes)
    assertTrue(plan.all { it.durationMs <= 30_000L })
    assertEquals(0L, plan[0].byteOffset)
    assertEquals(1_920_000L, plan[2].byteOffset)
  }

  @Test
  fun `accepts ASR segmentation input only from the owning task canonical wav paths`() {
    assertTrue(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "tasks/task-42/media/pcm/source.wav"))
    assertTrue(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "tasks/task-42/media/audio.wav"))
    assertFalse(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "tasks/other/media/pcm/source.wav"))
    assertFalse(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "tasks/task-42/media/other.wav"))
    assertFalse(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "tasks/task-42/media/remux/source.mp4"))
    assertFalse(TaskPrivateMediaPolicy.isTaskSegmentablePcmInputPath("task-42", "media/pcm/source.wav"))
  }

  @Test
  fun `rejects unsafe asr segment durations before creating files`() {
    try {
      PcmWavSegmentationPolicy.requireSegmentDurationMs(9_999)
      fail("Expected a short ASR segment duration to be rejected.")
    } catch (_: IllegalArgumentException) {
      // Expected: a caller cannot request unbounded tiny output files.
    }
    try {
      PcmWavSegmentationPolicy.requireSegmentDurationMs(120_001)
      fail("Expected an oversized ASR segment duration to be rejected.")
    } catch (_: IllegalArgumentException) {
      // Expected: a caller cannot force an unbounded provider upload.
    }
  }

  @Test
  fun `caps every ASR wav segment below the native attachment budget`() {
    val plan = PcmWavSegmentationPolicy.plan(
      sampleRateHz = 192_000,
      channelCount = 8,
      dataBytes = 30_720_000L,
      maxSegmentDurationMs = 30_000,
    )

    assertTrue(plan.size > 1)
    assertTrue(plan.all { it.dataBytes <= PcmWavSegmentationPolicy.MAX_SEGMENT_DATA_BYTES })
    assertTrue(plan.all { it.durationMs <= 30_000L })
  }

  @Test
  fun `allows only mp4 remux compatible tracks`() {
    assertTrue(TaskMediaRemuxPolicy.isSupportedVideoMime("video/avc"))
    assertTrue(TaskMediaRemuxPolicy.isSupportedVideoMime("video/hevc"))
    assertTrue(TaskMediaRemuxPolicy.isSupportedAudioMime("audio/mp4a-latm"))
    assertFalse(TaskMediaRemuxPolicy.isSupportedAudioMime("audio/opus"))
    assertFalse(TaskMediaRemuxPolicy.isSupportedVideoMime("video/webm"))
  }
}
