import { MIMO_CHAT_AUDIO_TTS_INSTRUCTION, OpenAiCompatibleProvider, reasoningDialectForBaseUrl, splitTranscriptRewriteChunks, STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION, TRANSCRIPT_REWRITE_SYSTEM_PROMPT } from "@hongtai/ai";
import { issueFromAppError, issueFromError, TaskError } from "@hongtai/core";
import type {
  AiAsrTransport,
  AiCapability,
  AiCapabilityProbeResult,
  AiConnectionPublicInput,
  AiTtsTransport,
  AppBuildInfo,
  AppRuntime,
  FeatureCapabilityRegistry,
  LocalProfile,
  MediaReference,
  ProfileUpdate,
  PublicAiConnectionConfig,
  ReplicaBlueprintRecord,
  TaskIssue,
  TranscriptSegment,
} from "@hongtai/core";
import { platformRegistry } from "@hongtai/platforms";

import { CapacitorAiTransport } from "./capacitor-ai-transport.js";
import { StandaloneAnalysisService } from "./standalone-analysis-service.js";
import { StandaloneDiagnosisService } from "./standalone-diagnosis-service.js";
import { StandaloneProductionService } from "./standalone-production-service.js";
import { StandaloneReplicaService } from "./standalone-replica-service.js";
import { RuntimeOperationRegistry } from "./runtime-operation-registry.js";
import { StandaloneRuntimeRecovery } from "./standalone-runtime-recovery.js";
import { NativeIngestPorts } from "./thin-ingest-ports.js";
import { StandaloneTaskService } from "./standalone-task-service.js";
import { StandaloneTemplateService } from "./standalone-template-service.js";
import type { StandaloneAiConnection, StandaloneLocalProfile, StandaloneNativePlugins } from "./standalone-bridge.js";

const LOCAL_PROFILE_ID = "local";
const ACTIVE_CONNECTION_ID = "active";
const FEATURES: FeatureCapabilityRegistry = Object.freeze({
  profile: "available",
  aiSettings: "available",
  ingest: "available",
  contentAnalysis: "available",
  diagnosis: "available",
  create: "available",
  templates: "available",
  publish: "planned",
});
const PROBE_ORDER: readonly AiCapability[] = ["text", "vision", "asr", "tts"];
/** 512px synthetic JPEG with no personal data; accepted by the configured vision provider. */
const VISION_PROBE_IMAGE_URL = new URL("./fixtures/vision-probe.jpg", import.meta.url);
/** A 16 kHz mono PCM WAV with one silent sample; accepted by real ASR endpoints. */
const PROBE_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
  0x64, 0x61, 0x74, 0x61, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export interface CreateStandaloneAppRuntimeOptions {
  readonly plugins: StandaloneNativePlugins;
  /** The only conversion from private native file URI to a WebView display URI. */
  readonly convertFileSrc: (uri: string) => string;
  readonly now?: () => Date;
  readonly createTaskId?: () => string;
  readonly createSessionId?: () => string;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function taskError(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string, action: ConstructorParameters<typeof TaskError>[0]["action"] = "none"): TaskError {
  return new TaskError({ code, message, action });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function loadVisionProbeImageDataUrl(): Promise<string> {
  const response = await fetch(VISION_PROBE_IMAGE_URL);
  if (!response.ok) {
    throw taskError("AI_CAPABILITY_PROBE_FAILED", "AI 能力探测未完成", "configure_ai");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw taskError("AI_CAPABILITY_PROBE_FAILED", "AI 能力探测未完成", "configure_ai");
  }
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) throw new TypeError();
    return url.toString();
  } catch {
    throw taskError("AI_SETTINGS_INVALID", "AI Base URL 必须是完整的 HTTPS 地址", "configure_ai");
  }
}

function validAsrTransport(value: string | null): AiAsrTransport {
  if (value === null || value === "" || value === "audio-transcriptions") return "audio-transcriptions";
  if (value === "chat-input-audio" || value === "stepaudio-sse") return value;
  throw taskError("AI_SETTINGS_INVALID", "ASR 传输方式无效", "configure_ai");
}

function validTtsTransport(value: string | null | undefined): AiTtsTransport | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "mimo-chat-audio" || value === "stepfun-audio-speech") return value;
  throw taskError("AI_SETTINGS_INVALID", "TTS 传输方式无效", "configure_ai");
}

function parseTags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function profileFromNative(value: StandaloneLocalProfile, toDisplayUri: (uri: string) => string): LocalProfile {
  return {
    localProfileId: value.localProfileId,
    remoteAccountId: value.remoteAccountId,
    displayName: value.displayName,
    avatarUri: value.avatarUri ? toDisplayUri(value.avatarUri) : null,
    businessName: value.businessName,
    industry: value.industry,
    businessTags: parseTags(value.businessTagsJson),
    createdAt: new Date(value.createdAtEpochMs).toISOString(),
    updatedAt: new Date(value.updatedAtEpochMs).toISOString(),
  };
}

function publicConnection(value: StandaloneAiConnection, hasApiKey: boolean): PublicAiConnectionConfig {
  return {
    connectionId: value.connectionId,
    baseUrl: value.baseUrl,
    textModel: optional(value.textModel),
    visionModel: optional(value.visionModel),
    asrModel: optional(value.asrModel),
    asrTransport: validAsrTransport(value.asrTransport),
    ttsModel: optional(value.ttsModel),
    ttsTransport: validTtsTransport(value.ttsTransport),
    ttsVoice: optional(value.ttsVoice),
    supportsJsonObject: value.jsonObjectEnabled,
    supportsJsonSchema: value.jsonSchemaEnabled,
    hasApiKey,
    createdAt: new Date(value.createdAtEpochMs).toISOString(),
    updatedAt: new Date(value.updatedAtEpochMs).toISOString(),
  };
}

function appBuildInfo(value: { readonly versionName: string; readonly versionCode: number }): AppBuildInfo {
  const versionName = optional(value.versionName);
  if (!versionName || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1) {
    throw taskError("APP_RUNTIME_UNAVAILABLE", "应用版本信息无效", "none");
  }
  return { versionName, versionCode: value.versionCode };
}

function parseProbeResults(value: string): readonly AiCapabilityProbeResult[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const value = item as Record<string, unknown>;
      if (!PROBE_ORDER.includes(value.capability as AiCapability) || (value.status !== "succeeded" && value.status !== "failed") || typeof value.checkedAt !== "string" ||
          (value.model !== null && value.model !== undefined && typeof value.model !== "string")) return [];
      const issue = value.issue && typeof value.issue === "object" ? value.issue as TaskIssue : undefined;
      return [{ capability: value.capability as AiCapability, status: value.status, checkedAt: value.checkedAt, model: (value.model as string | null | undefined) ?? null, ...(issue ? { issue } : {}) }];
    });
  } catch {
    return [];
  }
}

function safeDisplayUri(convertFileSrc: (uri: string) => string, uri: string): string {
  const display = convertFileSrc(uri);
  try {
    const parsed = new URL(display);
    if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "capacitor:")) throw new TypeError();
    return display;
  } catch {
    throw taskError("MEDIA_READ_FAILED", "无法生成安全的媒体展示地址", "select_media");
  }
}

/**
 * Minimal standalone composition root. The platform adapters, shared ingest
 * pipeline and AI flows are reused unchanged; Android receives only I/O,
 * Keystore and app-private file responsibilities.
 */
export async function createStandaloneAppRuntime(options: CreateStandaloneAppRuntimeOptions): Promise<AppRuntime> {
  const now = options.now ?? (() => new Date());
  const operations = new RuntimeOperationRegistry();
  const display = (uri: string) => safeDisplayUri(options.convertFileSrc, uri);
  // FileMedia returns an app-private URI; React only gets its display form.
  // Keep this tiny in-memory correspondence so save never persists a WebView URL.
  const avatarNativeUris = new Map<string, string>();
  const displayAvatar = (nativeUri: string): string => {
    const displayUri = display(nativeUri);
    avatarNativeUris.set(displayUri, nativeUri);
    return displayUri;
  };
  const nativeAvatar = (displayUri: string, existing: StandaloneLocalProfile | undefined): string => {
    const picked = avatarNativeUris.get(displayUri);
    if (picked) return picked;
    if (existing?.avatarUri && displayUri === displayAvatar(existing.avatarUri)) return existing.avatarUri;
    throw taskError("MEDIA_READ_FAILED", "头像文件已不可用，请重新选择图片", "select_media");
  };
  const transport = new CapacitorAiTransport({ nativeNetwork: options.plugins.nativeNetwork as never });

  const readConnection = async (): Promise<StandaloneAiConnection | undefined> => (await options.plugins.localData.getAiConnection()).connection;
  const getConnection = async (): Promise<PublicAiConnectionConfig | undefined> => {
    const connection = await readConnection();
    if (!connection) return undefined;
    const key = await options.plugins.secureSettings.hasSecret({ slot: "active-ai-connection" });
    return publicConnection(connection, key.exists === true);
  };
  const requireProvider = async (): Promise<OpenAiCompatibleProvider> => {
    const connection = await getConnection();
    if (!connection || !connection.hasApiKey) throw taskError("AI_NOT_CONFIGURED", "请先保存 AI 连接并写入 API Key", "configure_ai");
    if (!connection.textModel) throw taskError("AI_SETTINGS_INVALID", "请先填写文本模型", "configure_ai");
    return new OpenAiCompatibleProvider({
      transport,
      models: { text: connection.textModel, ...(connection.visionModel ? { vision: connection.visionModel } : {}), ...(connection.asrModel ? { asr: connection.asrModel } : {}) },
      supportsJsonObject: connection.supportsJsonObject,
      supportsJsonSchema: connection.supportsJsonSchema,
      asrTransport: connection.asrTransport,
      contextWindowTokens: 32_000,
      reasoningDialect: reasoningDialectForBaseUrl(connection.baseUrl),
    });
  };
  const narrationMode = async (): Promise<"system" | "provider"> => {
    const connection = await getConnection();
    return connection?.ttsModel && connection.ttsTransport && connection.ttsVoice ? "provider" : "system";
  };

  const ingestPorts = new NativeIngestPorts({
    network: options.plugins.nativeNetwork,
    downloadProgress: options.plugins.nativeNetwork,
    files: options.plugins.localFiles,
    media: options.plugins.mediaRuntime,
  });
  const transcriber = {
    transcribe: async (segmentPaths: readonly string[], segmentSeconds: number, onSegment?: (segment: TranscriptSegment, completed: number, total: number) => void | Promise<void>) => {
      const provider = await requireProvider();
      if (!(await getConnection())?.asrModel) throw taskError("AI_NOT_CONFIGURED", "未配置 ASR 模型", "configure_ai");
      const segments: TranscriptSegment[] = [];
      for (const [index, uri] of segmentPaths.entries()) {
        const startSeconds = index * segmentSeconds;
        const endSeconds = startSeconds + segmentSeconds;
        try {
          const text = (await provider.transcribe({ uri, filename: `segment-${index + 1}.wav`, mimeType: "audio/wav" })).trim();
          const segment: TranscriptSegment = { index, startSeconds, endSeconds, text, status: text ? "succeeded" : "no_speech" };
          segments.push(segment);
          await onSegment?.(segment, index + 1, segmentPaths.length);
        } catch (error) {
          const failure = issueFromError(error, "obtain-transcript");
          const segment: TranscriptSegment = { index, startSeconds, endSeconds, text: "", status: "failed", issue: failure };
          segments.push(segment);
          await onSegment?.(segment, index + 1, segmentPaths.length);
        }
      }
      const text = segments.filter((item) => item.status === "succeeded").map((item) => item.text).join("\n");
      return {
        status: text ? "transcribed" as const : segments.length > 0 && segments.every((item) => item.status === "no_speech") ? "no_speech" as const : "failed" as const,
        text,
        segments,
      };
    },
  };
  const rewriter = {
    rewrite: async (transcript: string) => {
      const provider = await requireProvider();
      const results: string[] = [];
      for (const chunk of splitTranscriptRewriteChunks(transcript)) {
        const result = await provider.generate({
          model: "text",
          output: "text",
          messages: [{ role: "system", content: TRANSCRIPT_REWRITE_SYSTEM_PROMPT }, { role: "user", content: chunk }],
        });
        results.push(result.content);
      }
      return results.join("\n\n");
    },
  };
  const tasks = new StandaloneTaskService({
    files: options.plugins.localFiles,
    fileMedia: options.plugins.fileMedia,
    adapters: platformRegistry.all,
    http: ingestPorts.http,
    downloader: ingestPorts.downloader,
    mediaTools: ingestPorts.mediaTools,
    transcriber,
    rewriter,
    toDisplayUri: display,
    ...(options.createTaskId ? { createTaskId: options.createTaskId } : {}),
    now,
    operations,
  });
  const analysis = new StandaloneAnalysisService({ files: options.plugins.localFiles, tasks, getProvider: requireProvider, now, operations });
  const diagnosis = new StandaloneDiagnosisService({
    files: options.plugins.localFiles,
    fileMedia: options.plugins.fileMedia,
    getProvider: requireProvider,
    toDisplayUri: display,
    ...(options.createSessionId ? { createSessionId: options.createSessionId } : {}),
    now,
    operations,
  });
  const unavailableProduction = {
    pickAssets: async () => { throw taskError("APP_RUNTIME_UNAVAILABLE", "本地制作插件尚未加载", "retry"); },
    consumeAssetOperation: async () => ({ status: "none" as const }),
    render: async () => { throw taskError("APP_RUNTIME_UNAVAILABLE", "本地制作插件尚未加载", "retry"); },
    probeTts: async () => { throw taskError("APP_RUNTIME_UNAVAILABLE", "本地配音插件尚未加载", "retry"); },
  };
  const production = new StandaloneProductionService({
    files: options.plugins.localFiles,
    native: options.plugins.productionRuntime ?? unavailableProduction,
    analysis,
    // Resolved lazily: the list is only needed once a project holds assets filmed against it, and
    // the two services own opposite ends of the same wizard.
    blueprints: { get: async (taskId): Promise<ReplicaBlueprintRecord | undefined> => replica.get(taskId) },
    tasks,
    getProvider: requireProvider,
    getNarrationMode: narrationMode,
    toDisplayUri: display,
    now,
    operations,
  });
  const replica: StandaloneReplicaService = new StandaloneReplicaService({
    files: options.plugins.localFiles,
    analysis,
    tasks,
    production,
    getProvider: requireProvider,
    now,
  });
  const recovery = new StandaloneRuntimeRecovery({ operations, sources: [tasks, analysis, diagnosis, production] });
  const templates = new StandaloneTemplateService({ files: options.plugins.localFiles, analysis, now });

  return {
    profile: {
      get: async () => {
        const response = await options.plugins.localData.getProfile();
        return response.profile ? profileFromNative(response.profile, displayAvatar) : undefined;
      },
      update: async (input: ProfileUpdate) => {
        const existing = (await options.plugins.localData.getProfile()).profile;
        const timestamp = now().getTime();
        const displayName = optional(input.displayName) ?? existing?.displayName ?? "";
        if (!displayName) throw taskError("PROFILE_SAVE_FAILED", "请填写显示名", "edit_input");
        const avatarUri = input.avatarUri === undefined
          ? existing?.avatarUri ?? null
          : input.avatarUri === null
            ? null
            : nativeAvatar(input.avatarUri, existing);
        const native: StandaloneLocalProfile = {
          localProfileId: LOCAL_PROFILE_ID,
          remoteAccountId: existing?.remoteAccountId ?? null,
          displayName,
          avatarUri,
          businessName: input.businessName === undefined ? existing?.businessName ?? null : optional(input.businessName),
          industry: input.industry === undefined ? existing?.industry ?? null : optional(input.industry),
          businessTagsJson: JSON.stringify(input.businessTags ?? (existing ? parseTags(existing.businessTagsJson) : [])),
          createdAtEpochMs: existing?.createdAtEpochMs ?? timestamp,
          updatedAtEpochMs: timestamp,
        };
        await options.plugins.localData.saveProfile(native);
        return profileFromNative(native, displayAvatar);
      },
      pickAvatar: (): Promise<MediaReference> => operations.track({
        kind: "transient-operation",
        id: "profile-avatar",
        execution: "external-activity",
      }, async () => {
        const image = await options.plugins.fileMedia.pickPhoto();
        if (!image.uri || !image.mimeType?.startsWith("image/") || image.sizeBytes <= 0) {
          throw taskError("MEDIA_IMPORT_FAILED", "头像导入没有返回有效图片", "select_media");
        }
        return { uri: displayAvatar(image.uri), kind: "image", origin: "imported", mimeType: image.mimeType, byteLength: image.sizeBytes, displayName: "本地头像" };
      }),
    },
    deviceSettings: {
      getAppInfo: async () => {
        const native = options.plugins.deviceSettings;
        if (!native) throw taskError("APP_RUNTIME_UNAVAILABLE", "应用信息暂时不可读取", "none");
        try {
          return appBuildInfo(await native.getAppInfo());
        } catch (error) {
          if (error instanceof TaskError) throw error;
          throw taskError("APP_RUNTIME_UNAVAILABLE", "应用信息暂时不可读取", "none");
        }
      },
    },
    aiSettings: {
      getPublic: getConnection,
      save: async (input: AiConnectionPublicInput) => {
        const baseUrl = validBaseUrl(input.baseUrl);
        const textModel = optional(input.textModel);
        if (!textModel) throw taskError("AI_SETTINGS_INVALID", "请填写文本模型", "configure_ai");
        const ttsModel = optional(input.ttsModel);
        const ttsTransport = validTtsTransport(input.ttsTransport);
        const ttsVoice = optional(input.ttsVoice);
        if (Boolean(ttsModel) !== Boolean(ttsTransport)) {
          throw taskError("AI_SETTINGS_INVALID", "TTS 模型与传输方式必须同时配置", "configure_ai");
        }
        if (ttsTransport && !ttsVoice) throw taskError("AI_SETTINGS_INVALID", "请填写 TTS 音色", "configure_ai");
        const existing = await readConnection();
        const timestamp = now().getTime();
        const native: StandaloneAiConnection = {
          connectionId: ACTIVE_CONNECTION_ID,
          baseUrl,
          textModel,
          visionModel: optional(input.visionModel),
          asrModel: optional(input.asrModel),
          asrTransport: input.asrTransport,
          ttsModel,
          ttsTransport,
          ttsVoice,
          jsonObjectEnabled: input.supportsJsonObject,
          jsonSchemaEnabled: input.supportsJsonSchema,
          probeResultsJson: "[]",
          createdAtEpochMs: existing?.createdAtEpochMs ?? timestamp,
          updatedAtEpochMs: timestamp,
        };
        await options.plugins.localData.saveAiConnection(native);
        const key = await options.plugins.secureSettings.hasSecret({ slot: "active-ai-connection" });
        return publicConnection(native, key.exists === true);
      },
      replaceApiKey: async (apiKey: string) => {
        if (!apiKey.trim()) throw taskError("AI_SETTINGS_INVALID", "API Key 不能为空", "configure_ai");
        if (!await readConnection()) throw taskError("AI_SETTINGS_INVALID", "请先保存公开 AI 配置", "configure_ai");
        await options.plugins.secureSettings.writeSecret({ slot: "active-ai-connection", value: apiKey.trim() });
      },
      probe: (capability: AiCapability): Promise<AiCapabilityProbeResult> => operations.track({
        kind: "transient-operation",
        id: `ai-probe:${capability}`,
        execution: "in-process",
      }, async () => {
        const startedAt = nowIso(now);
        const config = await getConnection();
        if (!config) throw taskError("AI_NOT_CONFIGURED", "请先保存 AI 连接", "configure_ai");
        const model = capability === "text" ? config.textModel : capability === "vision" ? config.visionModel : capability === "asr" ? config.asrModel : config.ttsModel;
        let result: AiCapabilityProbeResult;
        try {
          if (capability === "text") {
            const provider = await requireProvider();
            await provider.generate({ model: "text", output: "text", messages: [{ role: "user", content: "Reply with OK." }] });
          } else if (capability === "vision") {
            if (!config.visionModel) throw taskError("AI_SETTINGS_INVALID", "未配置视觉模型", "configure_ai");
            const provider = await requireProvider();
            const imageUrl = await loadVisionProbeImageDataUrl();
            await provider.generate({ model: "vision", output: "text", messages: [{ role: "user", content: [{ type: "text", text: "Reply with OK." }, { type: "image_url", imageUrl }] }] });
          } else if (capability === "asr") {
            if (!config.asrModel) throw taskError("AI_SETTINGS_INVALID", "未配置 ASR 模型", "configure_ai");
            const provider = await requireProvider();
            await provider.transcribe({ data: PROBE_WAV, filename: "probe.wav", mimeType: "audio/wav" });
          } else {
            if (!config.ttsModel || !config.ttsTransport || !config.ttsVoice) throw taskError("AI_SETTINGS_INVALID", "未配置云端 TTS", "configure_ai");
            const native = options.plugins.productionRuntime;
            if (!native) throw taskError("APP_RUNTIME_UNAVAILABLE", "本地配音插件尚未加载", "retry");
            await native.probeTts({
              miMoInstruction: MIMO_CHAT_AUDIO_TTS_INSTRUCTION,
              stepFunInstruction: STEPFUN_AUDIO_SPEECH_TTS_INSTRUCTION,
            });
          }
          result = { capability, status: "succeeded", checkedAt: startedAt, model: model ?? null };
        } catch (error) {
          result = { capability, status: "failed", checkedAt: startedAt, model: model ?? null, issue: issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "AI 能力探测未完成", action: "configure_ai" }) };
        }
        const native = await readConnection();
        if (!native) return result;
        const next = [...parseProbeResults(native.probeResultsJson).filter((item) => item.capability !== capability), result];
        await options.plugins.localData.compareAndSetAiProbeResults({
          expectedUpdatedAtEpochMs: native.updatedAtEpochMs,
          updatedAtEpochMs: Math.max(now().getTime(), native.updatedAtEpochMs + 1),
          probeResultsJson: JSON.stringify(next),
        });
        return result;
      }),
      getProbeResults: async () => {
        const connection = await readConnection();
        return connection ? [...parseProbeResults(connection.probeResultsJson)].sort((left, right) => PROBE_ORDER.indexOf(left.capability) - PROBE_ORDER.indexOf(right.capability)) : [];
      },
    },
    tasks,
    analysis,
    diagnosis,
    production,
    replica,
    recovery,
    templates,
    features: FEATURES,
  };
}
