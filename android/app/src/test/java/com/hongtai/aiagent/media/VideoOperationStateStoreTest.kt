package com.hongtai.aiagent.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoOperationStateStoreTest {
  private fun fixture(): Pair<VideoOperationStateStore, () -> String?> {
    var persisted: String? = null
    val store = VideoOperationStateStore(
      readPersisted = { persisted },
      writePersisted = { persisted = it },
      createOperationId = { "video-operation-1" },
      nowEpochMs = { 1_786_291_200_000L },
    )
    return store to { persisted }
  }

  @Test
  fun `picker operation reaches one recoverable success and clears after consumption`() {
    val (store, persisted) = fixture()
    val started = store.begin("task-local-1")

    val importing = store.markImporting(started.operationId, "content://picker/video-1")
    val completed = store.complete(
      started.operationId,
      ImportedTaskVideo(
        uri = "file:///private/tasks/task-local-1/media/video.mp4",
        mimeType = "video/mp4",
        displayName = "口播.mp4",
        sizeBytes = 128L,
        durationSeconds = 8.0,
      ),
    )

    assertEquals("task-local-1", importing?.taskId)
    assertEquals("content://picker/video-1", importing?.sourceUri)
    assertEquals("file:///private/tasks/task-local-1/media/video.mp4", completed?.uri)
    assertTrue(persisted()?.contains("video-operation-1") == true)
    assertEquals(completed, store.consumeTerminal())
    assertNull(store.current())
    assertNull(persisted())
  }

  @Test
  fun `cancel is a distinct terminal failure`() {
    val (store) = fixture()
    val started = store.begin("task-local-1")

    val failure = store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")

    assertEquals("ERR_MEDIA_SELECTION_CANCELLED", failure?.code)
    assertEquals("task-local-1", failure?.taskId)
  }

  @Test
  fun `missing picker uri is a distinct terminal failure`() {
    val (store) = fixture()
    val started = store.begin("task-local-1")

    val failure = store.fail(started.operationId, "ERR_MEDIA_SOURCE_MISSING")

    assertEquals("ERR_MEDIA_SOURCE_MISSING", failure?.code)
  }

  @Test
  fun `lost picker result becomes a recoverable terminal`() {
    val (store) = fixture()
    val started = store.begin("task-local-1")

    val failure = store.fail(started.operationId, "ERR_VIDEO_RECOVERY_FAILED")

    assertEquals("ERR_VIDEO_RECOVERY_FAILED", failure?.code)
    assertEquals("task-local-1", failure?.taskId)
  }

  @Test
  fun `first terminal wins when a duplicate callback arrives`() {
    val (store) = fixture()
    val started = store.begin("task-local-1")
    store.markImporting(started.operationId, "content://picker/video-1")
    val success = store.complete(
      started.operationId,
      ImportedTaskVideo(
        uri = "file:///private/tasks/task-local-1/media/video.mp4",
        mimeType = "video/mp4",
        displayName = "口播.mp4",
        sizeBytes = 128L,
        durationSeconds = 8.0,
      ),
    )

    val duplicate = store.fail(started.operationId, "ERR_PRIVATE_FILE_IMPORT_FAILED")

    assertNull(duplicate)
    assertEquals(success, store.current())
  }

  @Test
  fun `an active operation must finish and be consumed before another begins`() {
    val (store) = fixture()
    val started = store.begin("task-local-1")

    org.junit.Assert.assertThrows(IllegalStateException::class.java) {
      store.begin("task-local-2")
    }

    store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")
    store.consumeTerminal()
    assertEquals("task-local-2", store.begin("task-local-2").taskId)
  }
}
