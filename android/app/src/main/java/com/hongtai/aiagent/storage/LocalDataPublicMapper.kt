package com.hongtai.aiagent.storage

/** The only serializable fields exposed through LocalData. */
object LocalDataPublicMapper {
  fun profile(profile: LocalProfile): Map<String, Any?> = linkedMapOf(
    "localProfileId" to profile.localProfileId,
    "remoteAccountId" to profile.remoteAccountId,
    "displayName" to profile.displayName,
    "avatarUri" to profile.avatarUri,
    "businessName" to profile.businessName,
    "industry" to profile.industry,
    "businessTagsJson" to profile.businessTagsJson,
    "createdAtEpochMs" to profile.createdAtEpochMs,
    "updatedAtEpochMs" to profile.updatedAtEpochMs,
  )

  fun aiConnection(connection: LocalAiConnection): Map<String, Any?> = linkedMapOf(
    "connectionId" to connection.connectionId,
    "baseUrl" to connection.baseUrl,
    "textModel" to connection.textModel,
    "visionModel" to connection.visionModel,
    "asrModel" to connection.asrModel,
    "asrTransport" to connection.asrTransport,
    "ttsModel" to connection.ttsModel,
    "ttsTransport" to connection.ttsTransport,
    "ttsVoice" to connection.ttsVoice,
    "jsonObjectEnabled" to connection.jsonObjectEnabled,
    "jsonSchemaEnabled" to connection.jsonSchemaEnabled,
    "probeResultsJson" to connection.probeResultsJson,
    "createdAtEpochMs" to connection.createdAtEpochMs,
    "updatedAtEpochMs" to connection.updatedAtEpochMs,
  )
}
