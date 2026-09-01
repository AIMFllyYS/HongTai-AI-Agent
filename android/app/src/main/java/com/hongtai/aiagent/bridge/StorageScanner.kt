package com.hongtai.aiagent.bridge

import org.json.JSONObject
import java.io.File

/**
 * Aggregates the app's private storage by known roots instead of walking the
 * whole data directory.  Pure JVM file logic with no Android or Capacitor
 * dependency so the aggregation rules are unit-testable; the plugin only
 * adapts the results to Capacitor calls.
 *
 * Areas: tasks / observations / productions / templates are the business roots
 * under filesDir; cache collects imports, capture staging, code caches and
 * loose temporary files; everything else under dataDir is grouped as app-data
 * and is never deletable through this bridge.
 */
class StorageScanner(dataDir: File, filesDir: File, cacheDir: File, externalCacheDir: File?) {
  private val dataDir = dataDir.canonicalFile
  private val filesDir = filesDir.canonicalFile
  private val cacheDir = cacheDir.canonicalFile
  private val externalCacheDir = externalCacheDir?.canonicalFile

  /** Per-area aggregate returned by [inspect]; all six areas are always present. */
  data class AreaSummary(
    val area: String,
    val byteLength: Long,
    val itemCount: Long,
    val deletableByteLength: Long,
    val protectedByteLength: Long,
  )

  /** One never-listed, never-deletable app-data directory group. */
  data class AppDataGroup(val key: String, val byteLength: Long)

  data class Snapshot(val areas: List<AreaSummary>, val appDataGroups: List<AppDataGroup>)

  /** One listed file. [file] and [guardStatusFile] stay native-side; only [relativePath] crosses the bridge. */
  data class Item(
    val file: File,
    val area: String,
    val kind: String,
    val role: String,
    val byteLength: Long,
    val deletable: Boolean,
    val protectionCode: String?,
    val title: String,
    val group: String?,
    val relativePath: String,
    val guardStatusFile: File?,
  )

  data class CacheClearResult(val deletedCount: Long, val failedCount: Long, val freedBytes: Long)

  fun inspect(): Snapshot {
    val accumulators = AREA_ORDER.associateWith { AreaAccumulator() }
    for (area in BUSINESS_AREAS) scanBusinessArea(area, accumulators)
    val cache = accumulators.getValue("cache")
    scanCacheRoot(File(filesDir, "media/imports"), cache)
    scanCacheRoot(cacheDir, cache)
    scanCacheRoot(File(dataDir, "code_cache"), cache)
    externalCacheDir?.let { scanCacheRoot(it, cache) }
    // app_webview counts towards the cache footprint but is never deletable:
    // deleting WebView files while it is running can corrupt its state.
    scanTree(File(dataDir, "app_webview")) { bytes -> cache.add(bytes, deletable = false) }
    val groupStats = appDataGroupStats()
    val appData = accumulators.getValue("app-data")
    groupStats.forEach { group -> appData.add(group.byteLength, group.fileCount, deletable = false) }
    return Snapshot(
      areas = AREA_ORDER.map { area -> accumulators.getValue(area).summary(area) },
      appDataGroups = groupStats.map { AppDataGroup(it.key, it.byteLength) },
    )
  }

  /** Lists the files of one area. app-data is rejected: it is never listed nor deletable. */
  fun listAreaItems(area: String): List<Item> {
    require(area in AREA_ORDER && area != "app-data") { "The storage area is not listable." }
    val items = if (area == "cache") cacheItems() else businessItems(area)
    return items.sortedBy { it.relativePath }
  }

  /**
   * Deletes the safe cache subset: imports, cache roots, capture staging and
   * loose temporary files.  app_webview and temporary files guarded by busy
   * work are skipped.  Individual failures are counted, never fatal.
   */
  fun clearCache(): CacheClearResult {
    val candidates = mutableListOf<File>()
    collectFiles(File(filesDir, "media/imports"), candidates)
    collectFiles(cacheDir, candidates)
    collectFiles(File(dataDir, "code_cache"), candidates)
    externalCacheDir?.let { collectFiles(it, candidates) }
    for (area in BUSINESS_AREAS) {
      val root = File(filesDir, area)
      if (!root.isDirectory) continue
      root.walkTopDown().filter { it.isFile && it.extension.lowercase() in TEMPORARY_EXTENSIONS }.forEach { file ->
        val identifier = identifierOf(root, file)
        if (!isBusy(guardFile(area, identifier))) candidates.add(file)
      }
    }
    var deleted = 0L
    var failed = 0L
    var freed = 0L
    for (file in candidates) {
      val bytes = file.length()
      when {
        file.delete() -> { deleted++; freed += bytes }
        file.exists() -> failed++
        // Vanished concurrently: neither deleted nor failed.
      }
    }
    pruneEmptyDirs(File(filesDir, "media/imports"))
    pruneEmptyDirs(cacheDir)
    pruneEmptyDirs(File(dataDir, "code_cache"))
    externalCacheDir?.let(::pruneEmptyDirs)
    return CacheClearResult(deleted, failed, freed)
  }

  /** A guard file over 2MB or unreadable is treated as not busy. */
  fun isBusy(statusFile: File?): Boolean {
    if (statusFile == null || !statusFile.isFile || statusFile.length() > MAX_JSON_BYTES) return false
    val status = runCatching { JSONObject(statusFile.readText(Charsets.UTF_8)).optString("status", "") }.getOrDefault("")
    return status in BUSY_STATUSES
  }

  private fun scanBusinessArea(area: String, accumulators: Map<String, AreaAccumulator>) {
    val target = accumulators.getValue(area)
    val cache = accumulators.getValue("cache")
    val root = File(filesDir, area)
    val children = root.listFiles() ?: return
    for (child in children) {
      if (child.isDirectory) {
        val busy = isBusy(guardFile(area, child.name))
        scanTree(child) { bytes, file ->
          val extension = file.extension.lowercase()
          if (extension in TEMPORARY_EXTENSIONS) {
            cache.add(bytes, deletable = !busy)
          } else {
            val deletable = extension !in DATA_EXTENSIONS && extension in MEDIA_EXTENSIONS && !busy
            target.add(bytes, deletable)
          }
        }
      } else if (child.isFile) {
        // Loose file directly under the area root: guarded as unknown data.
        if (child.extension.lowercase() in TEMPORARY_EXTENSIONS) cache.add(child.length(), deletable = true)
        else target.add(child.length(), deletable = false)
      }
    }
  }

  private fun scanCacheRoot(root: File, cache: AreaAccumulator) {
    scanTree(root) { bytes -> cache.add(bytes, deletable = true) }
  }

  private fun scanTree(root: File, onFile: (bytes: Long, file: File) -> Unit) {
    if (!root.isDirectory) return
    root.walkTopDown().forEach { file -> if (file.isFile) onFile(file.length(), file) }
  }

  private fun scanTree(root: File, onFile: (bytes: Long) -> Unit) = scanTree(root) { bytes, _ -> onFile(bytes) }

  private data class GroupStats(val key: String, val byteLength: Long, val fileCount: Long)

  /** Groups every dataDir first-level directory we do not own, plus unknown files/ subdirectories. */
  private fun appDataGroupStats(): List<GroupStats> {
    val groups = mutableListOf<GroupStats>()
    val children = dataDir.listFiles() ?: return groups
    for (child in children) {
      when {
        child == filesDir -> groups.addAll(filesGroupStats(child))
        child.isDirectory && child.name !in OWNED_DATA_DIRS -> {
          val (bytes, count) = treeStats(child)
          groups.add(GroupStats(child.name, bytes, count))
        }
      }
    }
    return groups.sortedBy { it.key }
  }

  private fun filesGroupStats(root: File): List<GroupStats> {
    val groups = mutableListOf<GroupStats>()
    var looseBytes = 0L
    var looseCount = 0L
    root.listFiles()?.forEach { child ->
      when {
        child.isDirectory && child.name in KNOWN_FILES_DIRS -> Unit
        child.isDirectory -> {
          val (bytes, count) = treeStats(child)
          groups.add(GroupStats(child.name, bytes, count))
        }
        child.isFile -> { looseBytes += child.length(); looseCount++ }
      }
    }
    if (looseCount > 0) groups.add(GroupStats("files", looseBytes, looseCount))
    return groups
  }

  private fun treeStats(root: File): Pair<Long, Long> {
    var bytes = 0L
    var count = 0L
    scanTree(root) { fileBytes -> bytes += fileBytes; count++ }
    return bytes to count
  }

  private fun businessItems(area: String): List<Item> {
    val root = File(filesDir, area)
    val children = root.listFiles() ?: return emptyList()
    val items = mutableListOf<Item>()
    for (child in children) {
      if (child.isDirectory) {
        val identifier = child.name
        val guard = guardFile(area, identifier)
        val busy = isBusy(guard)
        val title = if (area == "tasks") readJsonString(File(child, "task.json"), "title") else ""
        val mode = if (area == "observations") {
          readJsonString(File(child, "session.json"), "mode").takeIf { it == "tongue" || it == "face" }
        } else {
          null
        }
        child.walkTopDown().filter { it.isFile && it.extension.lowercase() !in TEMPORARY_EXTENSIONS }.forEach { file ->
          relativePath(file)?.let { relative ->
            items.add(businessItem(area, file, relative, guard, busy, title, mode))
          }
        }
      } else if (child.isFile && child.extension.lowercase() !in TEMPORARY_EXTENSIONS) {
        relativePath(child)?.let { relative ->
          items.add(businessItem(area, child, relative, null, busy = false, title = "", mode = null))
        }
      }
    }
    return items
  }

  private fun businessItem(
    area: String,
    file: File,
    relative: String,
    guard: File?,
    busy: Boolean,
    title: String,
    mode: String?,
  ): Item {
    val extension = file.extension.lowercase()
    val kind = kindFor(extension, relative)
    return when {
      extension in DATA_EXTENSIONS ->
        Item(file, area, "document", "app-data", file.length(), false, "data", title, mode, relative, guard)
      kind == "other" ->
        Item(file, area, "other", "protected-other", file.length(), false, "unknown", title, mode, relative, guard)
      else ->
        Item(file, area, kind, mediaRole(area, relative, guard), file.length(), !busy, if (busy) "active" else null, title, mode, relative, guard)
    }
  }

  private fun cacheItems(): List<Item> {
    val items = mutableListOf<Item>()
    collectCacheItems(File(filesDir, "media/imports"), items, ::relativePath)
    collectCacheItems(cacheDir, items, ::relativePath)
    collectCacheItems(File(dataDir, "code_cache"), items, ::relativePath)
    externalCacheDir?.let { collectCacheItems(it, items, ::externalRelativePath) }
    for (area in BUSINESS_AREAS) {
      val root = File(filesDir, area)
      if (!root.isDirectory) continue
      root.walkTopDown().filter { it.isFile && it.extension.lowercase() in TEMPORARY_EXTENSIONS }.forEach { file ->
        val relative = relativePath(file) ?: return@forEach
        val guard = guardFile(area, identifierOf(root, file))
        val busy = isBusy(guard)
        items.add(Item(file, "cache", "temporary", "cache", file.length(), !busy, if (busy) "active" else null, "", null, relative, guard))
      }
    }
    return items
  }

  private fun collectCacheItems(root: File, items: MutableList<Item>, relative: (File) -> String?) {
    if (!root.isDirectory) return
    root.walkTopDown().filter { it.isFile }.forEach { file ->
      val path = relative(file) ?: return@forEach
      val kind = kindFor(file.extension.lowercase(), path).let { if (it == "other") "temporary" else it }
      items.add(Item(file, "cache", kind, "cache", file.length(), true, null, "", null, path, null))
    }
  }

  private fun collectFiles(root: File, into: MutableList<File>) {
    if (!root.isDirectory) return
    root.walkTopDown().filter { it.isFile }.forEach(into::add)
  }

  private fun pruneEmptyDirs(root: File) {
    if (!root.isDirectory) return
    root.walkTopDown().filter { it.isDirectory && it != root }.toList()
      .sortedByDescending { it.path.length }
      .forEach { dir -> if (dir.list()?.isEmpty() == true) dir.delete() }
  }

  private fun identifierOf(areaRoot: File, file: File): String {
    val relative = runCatching { file.relativeTo(areaRoot).path }.getOrDefault("")
    return relative.split(File.separatorChar, '/').firstOrNull().orEmpty()
  }

  private fun guardFile(area: String, identifier: String): File? {
    if (identifier.isBlank()) return null
    return when (area) {
      "tasks" -> File(filesDir, "tasks/$identifier/task.json")
      "observations" -> File(filesDir, "observations/$identifier/report.json")
      "productions" -> File(filesDir, "productions/$identifier/project.json")
      else -> null
    }
  }

  private fun mediaRole(area: String, path: String, guard: File?): String = when {
    // The persisted first frame is a regenerable derivative: deleting it is safe
    // because the media bridge recaptures it lazily the next time the task is read.
    area == "tasks" && path.endsWith("/media/thumbnail.jpg") -> "derived-frame"
    area == "tasks" && path.contains("/media/video") -> if (readJsonString(guard, "sourceKind") == "local_video") "user-video" else "parsed-video"
    area == "tasks" && path.contains("/media/audio") -> "parsed-audio"
    area == "tasks" && path.contains("/media/image") -> "parsed-image"
    area == "observations" -> "observation-image"
    area == "productions" && path.contains("/inputs/") -> "production-asset"
    area == "productions" && path.contains("output") -> "production-output"
    area == "productions" && path.contains("insight") -> "derived-frame"
    area == "templates" -> "template-media"
    else -> "protected-other"
  }

  private fun readJsonString(file: File?, key: String): String {
    if (file == null || !file.isFile || file.length() > MAX_JSON_BYTES) return ""
    return runCatching { JSONObject(file.readText(Charsets.UTF_8)).optString(key, "") }.getOrDefault("")
  }

  /** Forward-slash path relative to dataDir; never an absolute path. */
  private fun relativePath(file: File): String? {
    val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return null
    val prefix = dataDir.path + File.separator
    if (!canonical.path.startsWith(prefix)) return null
    return canonical.path.substring(prefix.length).replace(File.separatorChar, '/')
  }

  private fun externalRelativePath(file: File): String? {
    val root = externalCacheDir ?: return null
    val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return null
    val prefix = root.path + File.separator
    if (!canonical.path.startsWith(prefix)) return null
    return "external-cache/" + canonical.path.substring(prefix.length).replace(File.separatorChar, '/')
  }

  private class AreaAccumulator {
    private var byteLength = 0L
    private var itemCount = 0L
    private var deletableByteLength = 0L
    private var protectedByteLength = 0L

    fun add(bytes: Long, deletable: Boolean) = add(bytes, 1L, deletable)

    fun add(bytes: Long, count: Long, deletable: Boolean) {
      byteLength += bytes
      itemCount += count
      if (deletable) deletableByteLength += bytes else protectedByteLength += bytes
    }

    fun summary(area: String) = AreaSummary(area, byteLength, itemCount, deletableByteLength, protectedByteLength)
  }

  private companion object {
    val AREA_ORDER = listOf("tasks", "observations", "productions", "templates", "cache", "app-data")
    val BUSINESS_AREAS = listOf("tasks", "observations", "productions", "templates")
    val OWNED_DATA_DIRS = setOf("cache", "code_cache", "app_webview")
    val KNOWN_FILES_DIRS = BUSINESS_AREAS + "media"
    val VIDEO_EXTENSIONS = setOf("mp4", "mov", "m4v", "webm")
    val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "heic", "heif")
    val AUDIO_EXTENSIONS = setOf("wav", "mp3", "m4a", "aac", "ogg")
    val MEDIA_EXTENSIONS = VIDEO_EXTENSIONS + IMAGE_EXTENSIONS + AUDIO_EXTENSIONS
    val DATA_EXTENSIONS = setOf("json", "jsonl", "txt", "md")
    val TEMPORARY_EXTENSIONS = setOf("part", "tmp")
    val BUSY_STATUSES = setOf("queued", "running", "planning", "rendering")
    const val MAX_JSON_BYTES = 2L * 1024L * 1024L

    fun kindFor(extension: String, path: String): String = when {
      extension in VIDEO_EXTENSIONS || path.contains("/video") -> "video"
      extension in IMAGE_EXTENSIONS || path.contains("/image") || path.contains("/cover") -> "image"
      extension in AUDIO_EXTENSIONS || path.contains("/audio") -> "audio"
      extension in DATA_EXTENSIONS -> "document"
      extension in TEMPORARY_EXTENSIONS -> "temporary"
      else -> "other"
    }
  }
}
