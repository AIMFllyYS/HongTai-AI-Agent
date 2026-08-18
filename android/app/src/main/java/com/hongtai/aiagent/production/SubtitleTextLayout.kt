package com.hongtai.aiagent.production

import kotlin.math.ceil

/**
 * Line breaking and emphasis segmentation for burned-in captions.
 *
 * These two rules are the only part of the subtitle contract that has to exist in both
 * TypeScript and Kotlin: the web preview needs them to lay out DOM text, and the renderer needs
 * them to lay out canvas text. `SubtitleTextLayoutTest` pins the same expectations as the
 * TypeScript suite so the two implementations cannot drift apart silently.
 */
internal data class SubtitleSegment(val text: String, val emphasized: Boolean)

internal object SubtitleTextLayout {
  private val LINE_BREAK_AFTER = setOf(
    '，', '。', '！', '？', '；', '：', '、', '…', '）', '」', '》',
    ',', '.', '!', '?', ';', ':', ')', ' ',
  )
  private val WHITESPACE_RUN = Regex("\\s+")

  fun splitLines(text: String, maxCharsPerLine: Int): List<String> {
    val normalized = WHITESPACE_RUN.replace(text, " ").trim()
    if (normalized.isEmpty()) return emptyList()
    val limit = maxOf(1, maxCharsPerLine)
    val characters = codePoints(normalized)
    val lines = mutableListOf<String>()
    var index = 0

    while (index < characters.size) {
      if (characters.size - index <= limit) {
        lines += characters.subList(index, characters.size).joinToString("")
        break
      }
      val window = characters.subList(index, index + limit)
      var breakAt = -1
      val earliest = ceil(limit / 2.0).toInt()
      for (position in window.indices.reversed()) {
        if (position < earliest) break
        val candidate = window[position]
        if (candidate.length == 1 && LINE_BREAK_AFTER.contains(candidate[0])) {
          breakAt = position + 1
          break
        }
      }
      val take = if (breakAt > 0) breakAt else limit
      lines += window.subList(0, take).joinToString("").trim()
      index += take
    }

    return lines.filter { it.isNotEmpty() }
  }

  fun splitEmphasis(line: String, emphasisWords: List<String>): List<SubtitleSegment> {
    val words = emphasisWords.map(String::trim).filter(String::isNotEmpty)
    if (words.isEmpty()) return listOf(SubtitleSegment(line, false))

    val segments = mutableListOf<SubtitleSegment>()
    var cursor = 0
    while (cursor < line.length) {
      var matched = ""
      var matchedAt = -1
      for (word in words) {
        val at = line.indexOf(word, cursor)
        if (at < 0) continue
        if (matchedAt < 0 || at < matchedAt || (at == matchedAt && word.length > matched.length)) {
          matched = word
          matchedAt = at
        }
      }
      if (matchedAt < 0) {
        segments += SubtitleSegment(line.substring(cursor), false)
        break
      }
      if (matchedAt > cursor) segments += SubtitleSegment(line.substring(cursor, matchedAt), false)
      segments += SubtitleSegment(matched, true)
      cursor = matchedAt + matched.length
    }

    return segments.filter { it.text.isNotEmpty() }
  }

  /** Maps a whole-caption reveal onto one display line so karaoke sweeps in reading order. */
  fun lineProgress(lines: List<String>, index: Int, progress: Float): Float {
    val total = lines.sumOf { it.length }
    if (total == 0) return 0f
    val length = lines.getOrNull(index)?.length ?: 0
    if (length == 0) return 0f
    val start = lines.take(index).sumOf { it.length }
    val spoken = progress.coerceIn(0f, 1f) * total
    return ((spoken - start) / length).coerceIn(0f, 1f)
  }

  private fun codePoints(value: String): MutableList<String> {
    val characters = mutableListOf<String>()
    var offset = 0
    while (offset < value.length) {
      val width = Character.charCount(value.codePointAt(offset))
      characters += value.substring(offset, offset + width)
      offset += width
    }
    return characters
  }
}
