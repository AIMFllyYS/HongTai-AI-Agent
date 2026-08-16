package com.hongtai.aiagent.production

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssetOperationStateStoreTest {
  private fun fixture(): Pair<AssetOperationStateStore, () -> String?> {
    var persisted: String? = null
    val store = AssetOperationStateStore(
      readPersisted = { persisted },
      writePersisted = { persisted = it },
      createOperationId = { "asset-operation-1" },
      nowEpochMs = { 1_786_291_200_000L },
    )
    return store to { persisted }
  }

  private fun sampleAsset(): ImportedProductionAsset = ImportedProductionAsset(
    id = "asset-1",
    uri = "file:///private/productions/project-1/inputs/asset-1.jpg",
    kind = ProductionAssetKind.IMAGE,
    role = ProductionAssetRole.VISUAL,
    mimeType = "image/jpeg",
    displayName = "门店.jpg",
    sizeBytes = 100L,
    durationSeconds = null,
  )

  @Test
  fun `picker operation reaches one recoverable success and clears after consumption`() {
    val (store, persisted) = fixture()
    val started = store.begin("project-1", 3, ProductionImportSelection.VISUAL)

    val importing = store.markImporting(started.operationId, listOf("content://picker/asset-1"))
    val completed = store.complete(started.operationId, listOf(sampleAsset()))

    assertEquals("project-1", importing?.projectId)
    assertEquals(listOf("content://picker/asset-1"), importing?.sourceUris)
    assertEquals("asset-1", completed?.assets?.single()?.id)
    assertTrue(persisted()?.contains("asset-operation-1") == true)
    assertEquals(completed, store.consumeTerminal())
    assertNull(store.current())
    assertNull(persisted())
  }

  @Test
  fun `cancel is a distinct terminal failure`() {
    val (store) = fixture()
    val started = store.begin("project-1", 3, ProductionImportSelection.VISUAL)

    val failure = store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")

    assertEquals("ERR_MEDIA_SELECTION_CANCELLED", failure?.code)
    assertEquals("project-1", failure?.projectId)
  }

  @Test
  fun `lost picker result becomes a recoverable terminal`() {
    val (store) = fixture()
    val started = store.begin("project-1", 1, ProductionImportSelection.AVATAR)

    val failure = store.fail(started.operationId, "ERR_ASSET_RECOVERY_FAILED")

    assertEquals("ERR_ASSET_RECOVERY_FAILED", failure?.code)
    assertEquals(ProductionImportSelection.AVATAR, failure?.selection)
  }

  @Test
  fun `first terminal wins when a duplicate callback arrives`() {
    val (store) = fixture()
    val started = store.begin("project-1", 3, ProductionImportSelection.VISUAL)
    store.markImporting(started.operationId, listOf("content://picker/asset-1"))
    val success = store.complete(started.operationId, listOf(sampleAsset()))

    val duplicate = store.fail(started.operationId, "ERR_PRIVATE_FILE_IMPORT_FAILED")

    assertNull(duplicate)
    assertEquals(success, store.current())
  }

  @Test
  fun `an active operation must finish and be consumed before another begins`() {
    val (store) = fixture()
    val started = store.begin("project-1", 3, ProductionImportSelection.VISUAL)

    org.junit.Assert.assertThrows(IllegalStateException::class.java) {
      store.begin("project-2", 1, ProductionImportSelection.AVATAR)
    }

    store.fail(started.operationId, "ERR_MEDIA_SELECTION_CANCELLED")
    store.consumeTerminal()
    assertEquals("project-2", store.begin("project-2", 1, ProductionImportSelection.AVATAR).projectId)
  }
}
