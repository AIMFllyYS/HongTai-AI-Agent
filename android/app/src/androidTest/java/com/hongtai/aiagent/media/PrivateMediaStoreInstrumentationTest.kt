package com.hongtai.aiagent.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
      assertTrue(importedFile.inputStream().use { it.readNBytes(3) }.contentEquals(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())))
      assertTrue(maxOf(bounds.outWidth, bounds.outHeight) <= 2_048)
      assertTrue(imported.sizeBytes in 1..(15L * 1024L * 1024L))
    } finally {
      importedFile.delete()
      source.delete()
    }
  }
}
