package com.hongtai.aiagent.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoOperationStateStoreTest {
  private fun fixture(): Pair<PhotoOperationStateStore, () -> String?> {
    var persisted: String? = null
    val store = PhotoOperationStateStore(
      readPersisted = { persisted },
      writePersisted = { persisted = it },
      createOperationId = { "photo-operation-1" },
      nowEpochMs = { 1_786_291_200_000L },
    )
    return store to { persisted }
  }

  @Test
  fun `picker operation reaches one recoverable success and clears after consumption`() {
    val (store, persisted) = fixture()
    val started = store.beginPicker()

    val importing = store.markPickerImporting(started.operationId, "content://picker/photo-1")
    val completed = store.complete(
      started.operationId,
      PrivateMediaFile(uri = "file:///private/media/photo-1.jpg", mimeType = "image/jpeg", sizeBytes = 128L),
    )

    assertEquals(PhotoOperationKind.PICKER, importing?.kind)
    assertEquals("content://picker/photo-1", importing?.sourceUri)
    assertEquals("file:///private/media/photo-1.jpg", completed?.uri)
    assertTrue(persisted()?.contains("photo-operation-1") == true)
    assertEquals(completed, store.consumeTerminal())
    assertNull(store.current())
    assertNull(persisted())
  }

  @Test
  fun `cancel is a distinct terminal failure`() {
    val (store) = fixture()
    val started = store.beginPicker()

    val failure = store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")

    assertEquals("ERR_MEDIA_SELECTION_CANCELLED", failure?.code)
    assertEquals(PhotoOperationKind.PICKER, failure?.kind)
  }

  @Test
  fun `missing picker uri is a distinct terminal failure`() {
    val (store) = fixture()
    val started = store.beginPicker()

    val failure = store.fail(started.operationId, "ERR_MEDIA_SOURCE_MISSING")

    assertEquals("ERR_MEDIA_SOURCE_MISSING", failure?.code)
  }

  @Test
  fun `missing capture file becomes a recoverable lost capture terminal`() {
    val (store) = fixture()
    val started = store.beginCapture("capture-photo-operation-1.jpg")

    val importing = store.markCaptureImporting(started.operationId)
    val failure = store.fail(started.operationId, "ERR_PHOTO_CAPTURE_LOST")

    assertEquals("capture-photo-operation-1.jpg", importing?.captureFileName)
    assertEquals("ERR_PHOTO_CAPTURE_LOST", failure?.code)
    assertEquals(PhotoOperationKind.CAPTURE, failure?.kind)
  }

  @Test
  fun `first terminal wins when a duplicate callback arrives`() {
    val (store) = fixture()
    val started = store.beginPicker()
    store.markPickerImporting(started.operationId, "content://picker/photo-1")
    val success = store.complete(
      started.operationId,
      PrivateMediaFile(uri = "file:///private/media/photo-1.jpg", mimeType = "image/jpeg", sizeBytes = 128L),
    )

    val duplicate = store.fail(started.operationId, "ERR_PRIVATE_FILE_IMPORT_FAILED")

    assertNull(duplicate)
    assertEquals(success, store.current())
  }

  @Test
  fun `an active operation must finish and be consumed before another begins`() {
    val (store) = fixture()
    val started = store.beginPicker()

    org.junit.Assert.assertThrows(IllegalStateException::class.java) {
      store.beginCapture("capture-photo-operation-2.jpg")
    }

    store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")
    store.consumeTerminal()
    assertEquals(PhotoOperationKind.CAPTURE, store.beginCapture("capture-photo-operation-2.jpg").kind)
  }
}
