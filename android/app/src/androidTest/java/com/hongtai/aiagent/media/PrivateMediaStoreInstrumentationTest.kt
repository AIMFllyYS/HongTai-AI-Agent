package com.hongtai.aiagent.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrivateMediaStoreInstrumentationTest {
  @Test
  fun legacyHeifFallbackImportsBaselineAndAppliesIrotExactlyOnce() {
    assumeTrue("Native fallback is scoped to API 24 and 25", Build.VERSION.SDK_INT in 24..25)
    val context = ApplicationProvider.getApplicationContext<Context>()

    assertHeifImport(
      context = context,
      assetName = "baseline.heic",
      expectedWidth = 96,
      expectedHeight = 64,
      expectedCorners = listOf(RED, GREEN, BLUE, YELLOW),
    )
    assertHeifImport(
      context = context,
      assetName = "irot-90-cw.heic",
      expectedWidth = 64,
      expectedHeight = 96,
      expectedCorners = listOf(BLUE, RED, YELLOW, GREEN),
    )
  }

  @Test
  fun legacyHeifFallbackRejectsMalformedAndOverLimitFixturesWithoutResidue() {
    assumeTrue("Native fallback is scoped to API 24 and 25", Build.VERSION.SDK_INT in 24..25)
    val context = ApplicationProvider.getApplicationContext<Context>()
    val importsDirectory = File(context.filesDir, "media/imports").apply { mkdirs() }
    val before = importsDirectory.listFiles().orEmpty().map(File::getName).toSet()

    val malformed = copyHeifAsset(context, "truncated-ftyp.bin")
    val oversized = copyHeifAsset(context, "over-limit-dimension.heic")
    val externalReference = copyHeifAsset(context, "external-reference.heic")
    try {
      assertThrows(PrivateImageInvalidException::class.java) {
        PrivateMediaStore(context).importFrom(fileProviderUri(context, malformed), malformed.name)
      }
      assertThrows(PrivateMediaTooLargeException::class.java) {
        PrivateMediaStore(context).importFrom(fileProviderUri(context, oversized), oversized.name)
      }
      assertThrows(PrivateImageInvalidException::class.java) {
        PrivateMediaStore(context).importFrom(fileProviderUri(context, externalReference), externalReference.name)
      }
      assertEquals(before, importsDirectory.listFiles().orEmpty().map(File::getName).toSet())
      assertFalse(importsDirectory.listFiles().orEmpty().any(::isImportTemporary))
    } finally {
      malformed.delete()
      oversized.delete()
      externalReference.delete()
    }
  }

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

  private fun assertHeifImport(
    context: Context,
    assetName: String,
    expectedWidth: Int,
    expectedHeight: Int,
    expectedCorners: List<Int>,
  ) {
    val source = copyHeifAsset(context, assetName)
    val imported = PrivateMediaStore(context).importFrom(fileProviderUri(context, source), assetName)
    val importedFile = File(requireNotNull(android.net.Uri.parse(imported.uri).path))
    val bitmap = requireNotNull(BitmapFactory.decodeFile(importedFile.absolutePath))
    try {
      assertEquals("image/jpeg", imported.mimeType)
      assertEquals(expectedWidth, bitmap.width)
      assertEquals(expectedHeight, bitmap.height)
      val inset = 8
      val actualCorners = listOf(
        bitmap.getPixel(inset, inset),
        bitmap.getPixel(bitmap.width - inset - 1, inset),
        bitmap.getPixel(inset, bitmap.height - inset - 1),
        bitmap.getPixel(bitmap.width - inset - 1, bitmap.height - inset - 1),
      )
      actualCorners.zip(expectedCorners).forEachIndexed { index, (actual, expected) ->
        assertColorNear("$assetName corner $index", expected, actual)
      }
      assertFalse(File(context.filesDir, "media/imports").listFiles().orEmpty().any(::isImportTemporary))
    } finally {
      bitmap.recycle()
      importedFile.delete()
      source.delete()
    }
  }

  private fun copyHeifAsset(context: Context, assetName: String): File {
    val captureDirectory = File(context.cacheDir, "media/capture").apply { mkdirs() }
    return File(captureDirectory, "heif-$assetName").also { destination ->
      InstrumentationRegistry.getInstrumentation().context.assets.open("heif/$assetName").use { input ->
        destination.outputStream().use(input::copyTo)
      }
    }
  }

  private fun fileProviderUri(context: Context, file: File) =
    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

  private fun isImportTemporary(file: File): Boolean = file.name.endsWith(".part") || file.name.endsWith(".source")

  private fun assertColorNear(label: String, expected: Int, actual: Int) {
    val distance = kotlin.math.abs(Color.red(expected) - Color.red(actual)) +
      kotlin.math.abs(Color.green(expected) - Color.green(actual)) +
      kotlin.math.abs(Color.blue(expected) - Color.blue(actual))
    assertTrue("$label color distance was $distance", distance <= 90)
  }

  private companion object {
    const val RED = 0xffe8232a.toInt()
    const val GREEN = 0xff19aa4b.toInt()
    const val BLUE = 0xff2355dc.toInt()
    const val YELLOW = 0xfff5c823.toInt()
  }
}
