package com.hongtai.aiagent.production

import java.io.File

/**
 * The renderer's "audio already exists" path. The shared layer passes sentenceId → project-relative
 * audioPath pairs produced by the front-loaded narration stage; this maps them onto the plan's shot
 * order and refuses a missing or unreadable file instead of rendering a silent narration track.
 */
internal object ProductionNarrationAssets {
  fun resolve(
    plan: NativeProductionPlan,
    assets: Map<String, String>,
    openRelative: (String) -> File,
  ): List<Pair<File, Long>> {
    require(assets.isNotEmpty()) { "The narration audio assets are missing." }
    assets.forEach { (sentenceId, path) ->
      require(sentenceId.isNotBlank() && path.isNotBlank()) { "A narration audio asset is invalid." }
    }
    val remaining = assets.toMutableMap()
    return plan.shots.map { shot ->
      val sentenceId = shot.sentenceId
        ?: throw IllegalArgumentException("A narration audio asset needs a v4 measured plan sentence.")
      val relative = remaining.remove(sentenceId)
        ?: throw IllegalArgumentException("A narration audio asset does not exist.")
      val file = openRelative(relative)
      if (!file.isFile || !file.canRead()) throw IllegalArgumentException("A narration audio asset could not be read.")
      file to shot.durationMs
    }
  }
}
