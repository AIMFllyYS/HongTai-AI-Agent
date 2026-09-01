package com.hongtai.aiagent.media

import android.graphics.Bitmap
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID

/**
 * Shared atomic JPEG writer for frame derivatives. The bitmap is encoded into a
 * hidden `.part` sibling, fsynced and size-checked, and only then renamed over
 * the destination, so a reader can never observe a half-written frame. The
 * FF D8 check lets callers refuse a truncated file that still has bytes.
 */
internal object FrameJpegWriter {
  /** Returns false when encoding or finalization failed; the partial file is always removed. */
  fun writeAtomically(bitmap: Bitmap, destination: File, quality: Int, maxBytes: Long): Boolean {
    val temporary = File(destination.parentFile, ".${destination.name}.${UUID.randomUUID()}.part")
    try {
      FileOutputStream(temporary).use { output ->
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) return false
        output.fd.sync()
      }
      if (temporary.length() <= 0L || temporary.length() > maxBytes) return false
      return temporary.renameTo(destination)
    } catch (_: Exception) {
      return false
    } catch (_: OutOfMemoryError) {
      return false
    } finally {
      if (temporary.exists()) temporary.delete()
    }
  }

  fun isJpeg(file: File): Boolean = try {
    FileInputStream(file).use { input ->
      val header = ByteArray(2)
      input.read(header) == 2 && header[0] == 0xFF.toByte() && header[1] == 0xD8.toByte()
    }
  } catch (_: Exception) {
    false
  }
}
