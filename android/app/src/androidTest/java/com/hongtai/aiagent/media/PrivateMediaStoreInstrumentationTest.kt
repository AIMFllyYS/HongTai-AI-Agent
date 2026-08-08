package com.hongtai.aiagent.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrivateMediaStoreInstrumentationTest {
  @Test
  fun pickerImportNormalizesARealPngIntoBoundedJpeg() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val captureDirectory = File(context.cacheDir, "media/capture").apply { mkdirs() }
    val source = File(captureDirectory, "instrumentation-source.png")
    val bitmap = Bitmap.createBitmap(3_000, 1_000, Bitmap.Config.ARGB_8888).apply {
      eraseColor(0xff80cbc4.toInt())
    }
    FileOutputStream(source).use { output ->
      assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
      output.fd.sync()
    }
    bitmap.recycle()

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", source)
    val imported = PrivateMediaStore(context).importFrom(uri, "舌象测试.png")
    val importedFile = File(requireNotNull(android.net.Uri.parse(imported.uri).path))
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(importedFile.absolutePath, bounds)

    try {
      assertEquals("image/jpeg", imported.mimeType)
      assertTrue(importedFile.canonicalPath.startsWith(File(context.filesDir, "media/imports").canonicalPath))
      assertTrue(
        importedFile.inputStream().use(PrivateMediaImportPolicy::readHeader)
          .copyOfRange(0, 3)
          .contentEquals(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())),
      )
      assertTrue(maxOf(bounds.outWidth, bounds.outHeight) <= 2_048)
      assertTrue(imported.sizeBytes in 1..(15L * 1024L * 1024L))
      assertFalse(File(context.filesDir, "media/imports").listFiles().orEmpty().any { it.name.endsWith(".part") || it.name.endsWith(".source") })
    } finally {
      importedFile.delete()
      source.delete()
    }
  }

  @Test
  fun captureRecoveryUsesOnlyAnExistingConstrainedLeafFile() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = PrivateMediaStore(context)
    val capture = store.createPhotoCapture()
    capture.file.writeBytes(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte()))

    try {
      val restored = store.restorePhotoCapture(capture.file.name)
      assertNotNull(restored)
      assertEquals(capture.file.canonicalPath, restored?.file?.canonicalPath)
      assertEquals(capture.uri, restored?.uri)
      assertNull(store.restorePhotoCapture("../${capture.file.name}"))
      assertNull(store.restorePhotoCapture("capture-missing-file.jpg"))
    } finally {
      store.discardCapture(capture)
    }
  }

  @Test
  fun oversizedPickerSourceLeavesNoImportOrTemporaryFile() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val captureDirectory = File(context.cacheDir, "media/capture").apply { mkdirs() }
    val source = File(captureDirectory, "oversized-instrumentation-source.jpg")
    RandomAccessFile(source, "rw").use { file ->
      file.write(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte()))
      file.setLength(PrivateMediaImportPolicy.MAX_IMPORT_BYTES + 1L)
    }
    val importsDirectory = File(context.filesDir, "media/imports").apply { mkdirs() }
    val before = importsDirectory.listFiles().orEmpty().map(File::getName).toSet()
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", source)

    try {
      assertThrows(PrivateMediaTooLargeException::class.java) {
        PrivateMediaStore(context).importFrom(uri, source.name)
      }
      assertEquals(before, importsDirectory.listFiles().orEmpty().map(File::getName).toSet())
      assertFalse(importsDirectory.listFiles().orEmpty().any { it.name.endsWith(".part") || it.name.endsWith(".source") })
    } finally {
      source.delete()
    }
  }

  @Test
  fun unreadablePickerSourceHasADistinctReadFailureAndLeavesNoTemporaryFile() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val importsDirectory = File(context.filesDir, "media/imports").apply { mkdirs() }
    val before = importsDirectory.listFiles().orEmpty().map(File::getName).toSet()

    assertThrows(PrivateMediaReadException::class.java) {
      PrivateMediaStore(context).importFrom(android.net.Uri.parse("content://com.hongtai.aiagent.missing/photo"), "missing.jpg")
    }
    assertEquals(before, importsDirectory.listFiles().orEmpty().map(File::getName).toSet())
    assertFalse(importsDirectory.listFiles().orEmpty().any { it.name.endsWith(".part") || it.name.endsWith(".source") })
  }
}
