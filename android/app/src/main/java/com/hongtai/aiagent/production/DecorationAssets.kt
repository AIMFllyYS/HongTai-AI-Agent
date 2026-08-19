package com.hongtai.aiagent.production

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.IOException

/**
 * Resolves a bundled sticker PNG after Capacitor copies `apps/web/dist` into
 * `android/app/src/main/assets/public/`. The TypeScript catalogue owns the ids; this object only
 * concatenates that relative path onto the Capacitor prefix and reads bytes.
 */
internal object DecorationAssets {
  const val ASSET_PREFIX = "public"
  const val RELATIVE_DIR = "decorations"

  fun assetManagerPath(id: String): String = "$ASSET_PREFIX/$RELATIVE_DIR/$id.png"

  fun exists(assets: AssetManager, id: String): Boolean =
    try {
      assets.open(assetManagerPath(id)).close()
      true
    } catch (_: IOException) {
      false
    }

  /** Decode once per overlay construction. A missing or corrupt PNG must fail the export. */
  fun decode(assets: AssetManager, id: String): Bitmap {
    val bitmap = try {
      assets.open(assetManagerPath(id)).use { stream -> BitmapFactory.decodeStream(stream) }
    } catch (error: IOException) {
      throw IllegalArgumentException("A sticker PNG is missing from the packaged catalogue.", error)
    }
    return requireNotNull(bitmap) { "A sticker PNG could not be decoded." }
  }
}
