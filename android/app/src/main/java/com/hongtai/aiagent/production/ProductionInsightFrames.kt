package com.hongtai.aiagent.production

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import com.hongtai.aiagent.media.ImageFormatProbe
import com.hongtai.aiagent.media.PrivateObservationImageNormalizer
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

internal data class ProductionInsightFrame(val uri: String, val mimeType: String)

/**
 * Produces the bounded JPEG derivatives a vision model is allowed to see.
 *
 * Imported production assets are deliberately generous — up to 250 MiB and 8192px an edge — while
 * the AI attachment channel refuses anything over 15 MiB. Sending an original phone photo would
 * fail every time, so nothing reaches the model except a copy shrunk here. Videos additionally have
 * no still to send at all until one is extracted.
 */
internal class ProductionInsightFrames(private val store: ProductionMediaStore) {
  /**
   * Returns frames in playback order, or an empty list when this asset has nothing to look at.
   *
   * An empty result is a real answer: the caller records that the asset was never described rather
   * than pretending it was. Audio has no picture, and a missing asset is not an error worth failing
   * a whole production over.
   */
  fun frames(projectId: String, assetId: String): List<ProductionInsightFrame> {
    val input = store.input(projectId, assetId) ?: return emptyList()
    val directory = store.insightDirectory(projectId)
    clearStale(directory, assetId)
    return when (input.kind) {
      ProductionAssetKind.IMAGE -> imageFrame(File(input.path), directory, assetId)
      ProductionAssetKind.VIDEO -> videoFrames(File(input.path), directory, assetId, input.durationMs ?: 0L)
      ProductionAssetKind.AUDIO -> emptyList()
    }
  }

  private fun imageFrame(source: File, directory: File, assetId: String): List<ProductionInsightFrame> {
    val format = ImageFormatProbe.probe(source)
    val destination = File(directory, ProductionInsightFramePolicy.frameFileName(assetId, 0))
    val temporary = File(directory, ".${destination.name}.${UUID.randomUUID()}.part")
    // Reuses the observation import's normalizer, which already handles HEIF, EXIF rotation,
    // transparency flattening and the same 2048px edge. A second implementation would drift.
    PrivateObservationImageNormalizer.normalize(source, format, temporary, destination)
    return publishable(destination)
  }

  private fun videoFrames(source: File, directory: File, assetId: String, durationMs: Long): List<ProductionInsightFrame> {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(source.absolutePath)
      ProductionInsightFramePolicy.sampleMillis(durationMs)
        .take(ProductionInsightFramePolicy.MAX_FRAMES)
        .mapIndexedNotNull { index, millis -> frameAt(retriever, millis, directory, assetId, index) }
    } catch (_: Exception) {
      // A clip that cannot be read is left undescribed. Failing the production instead would block
      // an export the renderer is perfectly able to produce without ever looking at the picture.
      emptyList()
    } finally {
      releaseQuietly(retriever)
    }
  }

  private fun frameAt(
    retriever: MediaMetadataRetriever,
    millis: Long,
    directory: File,
    assetId: String,
    index: Int,
  ): ProductionInsightFrame? {
    var frame: Bitmap? = null
    var scaled: Bitmap? = null
    val destination = File(directory, ProductionInsightFramePolicy.frameFileName(assetId, index))
    val temporary = File(directory, ".${destination.name}.${UUID.randomUUID()}.part")
    try {
      frame = decodeFrame(retriever, millis * 1_000L) ?: return null
      scaled = scaleToFit(frame, ProductionInsightFramePolicy.MAX_EDGE_PIXELS)
      FileOutputStream(temporary).use { output ->
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, ProductionInsightFramePolicy.JPEG_QUALITY, output)) return null
        output.fd.sync()
      }
      if (temporary.length() <= 0L || temporary.length() > ProductionInsightFramePolicy.MAX_FRAME_BYTES) return null
      if (!temporary.renameTo(destination)) return null
      return publishable(destination).firstOrNull()
    } catch (_: Exception) {
      return null
    } catch (_: OutOfMemoryError) {
      return null
    } finally {
      if (temporary.exists()) temporary.delete()
      listOf(scaled, frame).distinct().forEach { bitmap ->
        if (bitmap != null && !bitmap.isRecycled) bitmap.recycle()
      }
    }
  }

  /**
   * `getScaledFrameAtTime` decodes straight into the target size, which avoids holding a full 4K
   * frame in memory. It only exists from API 27, so older devices decode and then shrink.
   */
  private fun decodeFrame(retriever: MediaMetadataRetriever, timeUs: Long): Bitmap? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      retriever.getScaledFrameAtTime(
        timeUs,
        MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
        ProductionInsightFramePolicy.MAX_EDGE_PIXELS,
        ProductionInsightFramePolicy.MAX_EDGE_PIXELS,
      )
    } else {
      retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
    }

  private fun publishable(destination: File): List<ProductionInsightFrame> {
    if (!destination.isFile || destination.length() <= 0L) return emptyList()
    if (destination.length() > ProductionInsightFramePolicy.MAX_FRAME_BYTES) {
      destination.delete()
      return emptyList()
    }
    return listOf(ProductionInsightFrame(uri = "file://${destination.absolutePath}", mimeType = "image/jpeg"))
  }

  private fun clearStale(directory: File, assetId: String) {
    directory.listFiles()?.forEach { file ->
      if (file.isFile && ProductionInsightFramePolicy.isFrameFileOf(assetId, file.name)) file.delete()
    }
  }

  private fun scaleToFit(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val edge = maxOf(bitmap.width, bitmap.height)
    if (edge <= maxEdge) return bitmap
    val scale = maxEdge.toFloat() / edge.toFloat()
    return Bitmap.createScaledBitmap(
      bitmap,
      (bitmap.width * scale).toInt().coerceAtLeast(1),
      (bitmap.height * scale).toInt().coerceAtLeast(1),
      true,
    )
  }

  private fun releaseQuietly(retriever: MediaMetadataRetriever) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) retriever.close() else retriever.release()
    } catch (_: Exception) {
      // Releasing a retriever that never opened a source is not a failure worth surfacing.
    }
  }
}
