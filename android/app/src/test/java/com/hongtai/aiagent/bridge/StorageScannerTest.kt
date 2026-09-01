package com.hongtai.aiagent.bridge

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class StorageScannerTest {
  private lateinit var root: File
  private lateinit var dataDir: File
  private lateinit var filesDir: File
  private lateinit var cacheDir: File
  private lateinit var externalCacheDir: File

  @Before
  fun setUp() {
    root = Files.createTempDirectory("storage-scanner-test").toFile()
    dataDir = File(root, "data").apply { mkdirs() }
    filesDir = File(dataDir, "files").apply { mkdirs() }
    cacheDir = File(dataDir, "cache").apply { mkdirs() }
    externalCacheDir = File(root, "external-cache").apply { mkdirs() }
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
  }

  @Test
  fun `task media counts into the tasks area and is deletable`() {
    writeData("files/tasks/task-1/media/video/source.mp4", "video-bytes")
    writeData("files/tasks/task-1/task.json", """{"status":"done","sourceKind":"local_video","title":"示例任务"}""")

    val tasks = scanner().inspect().areas.single { it.area == "tasks" }
    assertTrue("business areas must not report zero bytes", tasks.byteLength > 0)
    assertEquals("video-bytes".length.toLong(), tasks.deletableByteLength)
    assertTrue(tasks.protectedByteLength > 0)

    val items = scanner().listAreaItems("tasks")
    val media = items.single { it.relativePath == "files/tasks/task-1/media/video/source.mp4" }
    assertTrue(media.deletable)
    assertEquals("video", media.kind)
    assertEquals("user-video", media.role)
    assertEquals("示例任务", media.title)
    val document = items.single { it.relativePath == "files/tasks/task-1/task.json" }
    assertFalse(document.deletable)
    assertEquals("data", document.protectionCode)
  }

  @Test
  fun `busy task media is protected from deletion`() {
    writeData("files/tasks/task-1/media/video/source.mp4", "video-bytes")
    writeData("files/tasks/task-1/task.json", """{"status":"running"}""")

    val tasks = scanner().inspect().areas.single { it.area == "tasks" }
    assertEquals(0L, tasks.deletableByteLength)

    val media = scanner().listAreaItems("tasks").single { it.kind == "video" }
    assertFalse(media.deletable)
    assertEquals("active", media.protectionCode)
    assertTrue(scanner().isBusy(File(filesDir, "tasks/task-1/task.json")))
  }

  @Test
  fun `oversized guard files are treated as not busy`() {
    writeData("files/tasks/task-1/media/video/source.mp4", "video-bytes")
    writeData("files/tasks/task-1/task.json", " ".repeat(2 * 1024 * 1024 + 16))

    val media = scanner().listAreaItems("tasks").single { it.kind == "video" }
    assertTrue(media.deletable)
  }

  @Test
  fun `observation media carries the session mode as group`() {
    writeData("files/observations/session-1/image.jpg", "photo")
    writeData("files/observations/session-1/session.json", """{"mode":"tongue"}""")
    writeData("files/observations/session-1/report.json", """{"status":"done"}""")

    val items = scanner().listAreaItems("observations")
    val image = items.single { it.relativePath == "files/observations/session-1/image.jpg" }
    assertEquals("observation-image", image.role)
    assertEquals("tongue", image.group)
    assertEquals("", image.title)
    assertTrue(image.deletable)

    val observations = scanner().inspect().areas.single { it.area == "observations" }
    assertEquals("photo".length.toLong(), observations.deletableByteLength)
  }

  @Test
  fun `observation items omit group when the session mode is unreadable`() {
    writeData("files/observations/session-1/image.png", "photo")

    val image = scanner().listAreaItems("observations").single()
    assertNull(image.group)
  }

  @Test
  fun `app_webview counts into cache but stays protected and unlisted`() {
    writeData("app_webview/Default/Cache/data.bin", "webview-state")
    writeData("cache/junk.tmp", "junk")

    val cache = scanner().inspect().areas.single { it.area == "cache" }
    assertTrue(cache.byteLength >= "webview-state".length + "junk".length)
    assertEquals("junk".length.toLong(), cache.deletableByteLength)
    assertEquals("webview-state".length.toLong(), cache.protectedByteLength)

    val listed = scanner().listAreaItems("cache")
    assertTrue(listed.none { it.relativePath.startsWith("app_webview/") })
    assertTrue(listed.any { it.relativePath == "cache/junk.tmp" })
  }

  @Test
  fun `shared_prefs and databases aggregate into app-data groups`() {
    writeData("shared_prefs/prefs.xml", "prefs")
    writeData("databases/history.db", "database")

    val snapshot = scanner().inspect()
    val groups = snapshot.appDataGroups.associate { it.key to it.byteLength }
    assertEquals("prefs".length.toLong(), groups["shared_prefs"])
    assertEquals("database".length.toLong(), groups["databases"])

    val appData = snapshot.areas.single { it.area == "app-data" }
    assertEquals("prefs".length + "database".length.toLong(), appData.byteLength)
    assertEquals(0L, appData.deletableByteLength)
    assertEquals(appData.byteLength, appData.protectedByteLength)

    assertThrows(IllegalArgumentException::class.java) { scanner().listAreaItems("app-data") }
  }

  @Test
  fun `media imports and temporary files are deletable cache`() {
    writeData("files/media/imports/imported.mp4", "imported")
    writeData("files/tasks/task-1/media/video/download.mp4.part", "partial")
    writeData("files/tasks/task-1/task.json", """{"status":"done"}""")

    val cache = scanner().inspect().areas.single { it.area == "cache" }
    assertEquals("imported".length + "partial".length.toLong(), cache.deletableByteLength)

    val tasks = scanner().inspect().areas.single { it.area == "tasks" }
    assertEquals("temporary files must not count towards the business area", """{"status":"done"}""".length.toLong(), tasks.byteLength)

    val listed = scanner().listAreaItems("cache")
    val imported = listed.single { it.relativePath == "files/media/imports/imported.mp4" }
    assertEquals("video", imported.kind)
    assertEquals("cache", imported.role)
    assertTrue(imported.deletable)
    val partial = listed.single { it.relativePath == "files/tasks/task-1/media/video/download.mp4.part" }
    assertEquals("temporary", partial.kind)
    assertTrue(partial.deletable)
    // Temporary files only appear in the cache listing.
    assertTrue(scanner().listAreaItems("tasks").none { it.relativePath.endsWith(".part") })
  }

  @Test
  fun `clearCache deletes the safe cache subset and skips app_webview and busy temporaries`() {
    val capture = writeData("cache/media/capture/photo.jpg", "capture")
    val probe = writeData("cache/hongtai-tts-probe-1.wav", "probe")
    val codeCache = writeData("code_cache/jit/blob", "jit")
    val imported = writeData("files/media/imports/imported.mp4", "imported")
    val webview = writeData("app_webview/Default/Cache/data.bin", "webview-state")
    val busyPart = writeData("files/tasks/task-1/media/video/download.mp4.part", "partial")
    writeData("files/tasks/task-1/task.json", """{"status":"running"}""")
    val external = File(externalCacheDir, "stale.bin").apply { writeText("stale") }

    val result = scanner().clearCache()
    assertFalse(capture.exists())
    assertFalse(probe.exists())
    assertFalse(codeCache.exists())
    assertFalse(imported.exists())
    assertFalse(external.exists())
    assertTrue("app_webview must survive cache clearing", webview.exists())
    assertTrue("busy temporaries must survive cache clearing", busyPart.exists())
    assertEquals(0L, result.failedCount)
    assertEquals(5L, result.deletedCount)
    assertEquals(
      "capture".length + "probe".length + "jit".length + "imported".length + "stale".length.toLong(),
      result.freedBytes,
    )
  }

  @Test
  fun `task video first frame is a deletable derived artifact`() {
    writeData("files/tasks/task-1/media/video.mp4", "video-bytes")
    writeData("files/tasks/task-1/media/thumbnail.jpg", "jpeg-bytes")
    writeData("files/tasks/task-1/task.json", """{"status":"done"}""")

    val items = scanner().listAreaItems("tasks")
    val thumbnail = items.single { it.relativePath == "files/tasks/task-1/media/thumbnail.jpg" }
    assertEquals("image", thumbnail.kind)
    assertEquals("derived-frame", thumbnail.role)
    // Safe to delete: the media bridge recaptures the frame lazily on the next read.
    assertTrue(thumbnail.deletable)
    assertNull(thumbnail.protectionCode)

    val tasks = scanner().inspect().areas.single { it.area == "tasks" }
    assertEquals("video-bytes".length + "jpeg-bytes".length.toLong(), tasks.deletableByteLength)
  }

  @Test
  fun `snapshot always reports all six areas`() {
    val areas = scanner().inspect().areas.map { it.area }
    assertEquals(listOf("tasks", "observations", "productions", "templates", "cache", "app-data"), areas)
  }

  private fun scanner() = StorageScanner(dataDir, filesDir, cacheDir, externalCacheDir)

  private fun writeData(relativePath: String, content: String): File {
    val file = File(dataDir, relativePath)
    file.parentFile?.mkdirs()
    file.writeText(content)
    return file
  }
}
