package com.hongtai.aiagent.media

import java.io.File
import java.io.InputStream

internal enum class ImageFormat {
  JPEG,
  PNG,
  WEBP,
  HEIF_CANDIDATE,
  UNSUPPORTED,
}

/** Bounded byte-level image format authority for app-private staged imports. */
internal object ImageFormatProbe {
  const val MAX_PROBE_BYTES = 64 * 1024
  const val MAX_TOP_LEVEL_BOXES = 64

  private val pngMagic = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  private val heifBrands = setOf("heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1")
  private val avifBrands = setOf("avif", "avis")

  fun probe(file: File): ImageFormat {
    if (!file.isFile || file.length() <= 0L) return ImageFormat.UNSUPPORTED
    return file.inputStream().buffered().use { probe(it, file.length()) }
  }

  fun probe(input: InputStream, sourceSize: Long): ImageFormat {
    if (sourceSize <= 0L) return ImageFormat.UNSUPPORTED
    val bytesToRead = minOf(sourceSize, MAX_PROBE_BYTES.toLong()).toInt()
    val prefix = ByteArray(bytesToRead)
    var offset = 0
    while (offset < prefix.size) {
      val count = input.read(prefix, offset, prefix.size - offset)
      if (count < 0) break
      if (count == 0) continue
      offset += count
    }
    val bytes = if (offset == prefix.size) prefix else prefix.copyOf(offset)
    if (isJpeg(bytes)) return ImageFormat.JPEG
    if (bytes.size >= pngMagic.size && bytes.copyOfRange(0, pngMagic.size).contentEquals(pngMagic)) return ImageFormat.PNG
    if (bytes.size >= 12 && ascii(bytes, 0) == "RIFF" && ascii(bytes, 8) == "WEBP") return ImageFormat.WEBP
    return probeIsoBmff(bytes, sourceSize)
  }

  private fun isJpeg(bytes: ByteArray): Boolean =
    bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()

  private fun probeIsoBmff(bytes: ByteArray, sourceSize: Long): ImageFormat {
    var position = 0L
    var inspected = 0
    while (inspected < MAX_TOP_LEVEL_BOXES && position <= sourceSize - 8L) {
      if (position > bytes.size.toLong() - 8L) return ImageFormat.UNSUPPORTED
      val offset = position.toInt()
      val compactSize = unsignedInt(bytes, offset)
      val type = ascii(bytes, offset + 4)
      val headerSize: Long
      val boxSize: Long
      if (compactSize == 0L) return ImageFormat.UNSUPPORTED
      if (compactSize == 1L) {
        if (position > bytes.size.toLong() - 16L) return ImageFormat.UNSUPPORTED
        headerSize = 16L
        boxSize = unsignedLong(bytes, offset + 8) ?: return ImageFormat.UNSUPPORTED
      } else {
        headerSize = 8L
        boxSize = compactSize
      }
      if (boxSize < headerSize || boxSize > Long.MAX_VALUE - position) return ImageFormat.UNSUPPORTED
      val end = position + boxSize
      if (end > sourceSize) return ImageFormat.UNSUPPORTED
      if (type == "ftyp") return inspectFtyp(bytes, position, end, headerSize)
      if (end > bytes.size.toLong()) return ImageFormat.UNSUPPORTED
      position = end
      inspected++
    }
    return ImageFormat.UNSUPPORTED
  }

  private fun inspectFtyp(bytes: ByteArray, start: Long, end: Long, headerSize: Long): ImageFormat {
    val payloadStart = start + headerSize
    if (end > bytes.size.toLong() || end - payloadStart < 8L || (end - payloadStart) % 4L != 0L) {
      return ImageFormat.UNSUPPORTED
    }
    val brands = mutableSetOf<String>()
    brands += ascii(bytes, payloadStart.toInt())
    var position = payloadStart + 8L
    while (position < end) {
      brands += ascii(bytes, position.toInt())
      position += 4L
    }
    if (brands.any(avifBrands::contains)) return ImageFormat.UNSUPPORTED
    return if (brands.any(heifBrands::contains)) ImageFormat.HEIF_CANDIDATE else ImageFormat.UNSUPPORTED
  }

  private fun unsignedInt(bytes: ByteArray, offset: Int): Long =
    ((bytes[offset].toLong() and 0xffL) shl 24) or
      ((bytes[offset + 1].toLong() and 0xffL) shl 16) or
      ((bytes[offset + 2].toLong() and 0xffL) shl 8) or
      (bytes[offset + 3].toLong() and 0xffL)

  private fun unsignedLong(bytes: ByteArray, offset: Int): Long? {
    if (bytes[offset].toInt() and 0x80 != 0) return null
    var value = 0L
    repeat(8) { index -> value = (value shl 8) or (bytes[offset + index].toLong() and 0xffL) }
    return value
  }

  private fun ascii(bytes: ByteArray, offset: Int): String =
    bytes.copyOfRange(offset, offset + 4).toString(Charsets.US_ASCII)
}
