import type { LocalTaskFilesPlugin } from "./thin-task-files.js";
import type {
  NativeDownloadPort,
  NativeDownloadProgressEvent,
  NativeDownloadListenerHandle,
  NativeMediaPort,
  NativeTaskMediaFilesPort,
  NativeTextFetchPort,
} from "./thin-ingest-ports.js";

export type NativePluginRegistrar = <T>(name: string) => T;
export type NativeUri = string;

export type NativeAiMediaSource =
  | { readonly kind: "base64"; readonly base64: string }
  | { readonly kind: "uri"; readonly uri: NativeUri };

export type NativeAiAttachmentMaterialization = "raw-base64" | "data-url-base64";

export interface NativeAiJsonAttachment {
  readonly pointer: string;
  readonly source: NativeAiMediaSource;
  readonly mimeType: string;
  readonly materialization: NativeAiAttachmentMaterialization;
}

export interface NativeAiMultipartFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly source: NativeAiMediaSource;
}

export type NativeAiRequestBody =
  | { readonly kind: "json"; readonly json: string; readonly attachments?: readonly NativeAiJsonAttachment[] }
  | { readonly kind: "multipart"; readonly fields: Readonly<Record<string, string>>; readonly file: NativeAiMultipartFile };

export interface NativeAiRequestStart {
  readonly version: "ai-transport.v1";
  readonly requestId: string;
  readonly relativePath: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: NativeAiRequestBody;
  readonly responseMode: "json" | "stream";
  readonly timeoutMs?: number;
}

export interface NativeAiRequestStartResult {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export type NativeAiRequestEvent =
  | { readonly type: "chunk"; readonly requestId: string; readonly sequence: number; readonly chunk: string }
  | { readonly type: "completed"; readonly requestId: string; readonly sequence: number; readonly bodyText?: string }
  | { readonly type: "failed"; readonly requestId: string; readonly sequence: number; readonly code: string; readonly userMessage: string; readonly retryable?: boolean };

export interface NativeAiListenerHandle {
  remove(): Promise<void>;
}

export interface StandaloneSecureSettingsPlugin {
  writeSecret(options: { readonly slot: "active-ai-connection"; readonly value: string }): Promise<void>;
  hasSecret(options: { readonly slot: "active-ai-connection" }): Promise<{ readonly exists: boolean }>;
  removeSecret(options: { readonly slot: "active-ai-connection" }): Promise<void>;
}

/** Narrow Android-only bridge for compiled application metadata. */
export interface StandaloneDeviceSettingsPlugin {
  getAppInfo(): Promise<{ readonly versionName: string; readonly versionCode: number }>;
}

/** Public app-preferences projection. It never contains an API Key. */
export interface StandaloneLocalProfile {
  readonly localProfileId: string;
  readonly remoteAccountId: string | null;
  readonly displayName: string;
  readonly avatarUri: string | null;
  readonly businessName: string | null;
  readonly industry: string | null;
  readonly businessTagsJson: string;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
}

/** One OpenAI-compatible connection's public metadata. */
export interface StandaloneAiConnection {
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly textModel: string;
  readonly visionModel: string | null;
  readonly asrModel: string | null;
  readonly asrTransport: string | null;
  readonly ttsModel: string | null;
  readonly ttsTransport: string | null;
  readonly ttsVoice: string | null;
  readonly jsonObjectEnabled: boolean;
  readonly jsonSchemaEnabled: boolean;
  readonly probeResultsJson: string;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
}

/** Existing `LocalData` plugin name, now backed by tiny SharedPreferences state. */
export interface StandaloneLocalDataPlugin {
  getProfile(): Promise<{ readonly profile?: StandaloneLocalProfile }>;
  saveProfile(options: StandaloneLocalProfile): Promise<void>;
  getAiConnection(): Promise<{ readonly connection?: StandaloneAiConnection }>;
  saveAiConnection(options: StandaloneAiConnection): Promise<void>;
  compareAndSetAiProbeResults(options: {
    readonly expectedUpdatedAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly probeResultsJson: string;
  }): Promise<{ readonly applied: boolean }>;
}

export type LocalFilesArea = "task" | "observation" | "production" | "template";

/**
 * Fixed, app-private file operations only. React never receives a native path
 * and cannot call this bridge directly; the runtime converts controlled file
 * URIs into display URIs at its presentation boundary.
 */
export interface StandaloneLocalFilesPlugin extends LocalTaskFilesPlugin, NativeTaskMediaFilesPort {
  ensure(options: { readonly taskId: string }): Promise<void>;
  readText(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  exists(options: { readonly taskId: string; readonly relativePath: string }): Promise<{ readonly exists: boolean }>;
  listTaskIds(): Promise<{ readonly taskIds: readonly string[] }>;
  deleteTask(options: { readonly taskId: string }): Promise<void>;
  getUri(options: { readonly taskId: string; readonly relativePath: string }): Promise<{
    readonly uri?: NativeUri;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
  copyPrivateFile(options: { readonly taskId: string; readonly sourceUri: NativeUri; readonly relativePath: string }): Promise<void>;
  ensureObservation(options: { readonly sessionId: string }): Promise<void>;
  writeObservationText(options: {
    readonly sessionId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  readObservationText(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listObservationIds(): Promise<{ readonly sessionIds: readonly string[] }>;
  deleteObservation(options: { readonly sessionId: string }): Promise<void>;
  copyToObservation(options: { readonly sessionId: string; readonly sourceUri: NativeUri; readonly relativePath: string }): Promise<{
    readonly uri: NativeUri;
    readonly sizeBytes: number;
    readonly mimeType?: string;
  }>;
  getObservationUri(options: { readonly sessionId: string; readonly relativePath: string }): Promise<{
    readonly uri?: NativeUri;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  }>;
  ensureProduction(options: { readonly projectId: string }): Promise<void>;
  writeProductionText(options: {
    readonly projectId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  readProductionText(options: { readonly projectId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listProductionIds(): Promise<{ readonly projectIds: readonly string[] }>;
  deleteProductionFile(options: { readonly projectId: string; readonly relativePath: string }): Promise<void>;
  deleteProduction(options: { readonly projectId: string }): Promise<void>;
  ensureTemplate(options: { readonly templateId: string }): Promise<void>;
  writeTemplateText(options: {
    readonly templateId: string;
    readonly relativePath: string;
    readonly value: string;
    readonly replace: boolean;
  }): Promise<void>;
  readTemplateText(options: { readonly templateId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listTemplateIds(): Promise<{ readonly templateIds: readonly string[] }>;
  deleteTemplate(options: { readonly templateId: string }): Promise<void>;
}

export type NativeStorageArea = "tasks" | "observations" | "productions" | "templates" | "cache" | "app-data";
export type NativeStorageItemKind = "video" | "image" | "audio" | "document" | "temporary" | "other";
export type NativeStorageRole =
  | "user-video"
  | "parsed-video"
  | "parsed-audio"
  | "parsed-image"
  | "observation-image"
  | "production-asset"
  | "production-output"
  | "derived-frame"
  | "template-media"
  | "cache"
  | "app-data"
  | "protected-other";
export type NativeStorageProtectionCode = "data" | "active" | "unknown";

export interface NativeStorageAreaSummary {
  readonly area: NativeStorageArea;
  readonly byteLength: number;
  readonly itemCount: number;
  readonly deletableByteLength: number;
  readonly protectedByteLength: number;
}

export interface NativeStorageAppDataGroup {
  readonly key: string;
  readonly byteLength: number;
}

/**
 * Aggregated v2 inspection: per-area statistics plus app-data directory
 * groups, without any per-file detail.  Items are listed on demand through
 * `listAreaItems`.
 */
export interface NativeStorageSnapshot {
  readonly schemaVersion: "native-storage.v2";
  readonly generatedAtEpochMs: number;
  readonly device: { readonly totalBytes: number; readonly freeBytes: number };
  readonly areas: readonly NativeStorageAreaSummary[];
  readonly appDataGroups: readonly NativeStorageAppDataGroup[];
}

/**
 * Native item listings deliberately return opaque delete handles rather than
 * usable paths.  The Android implementation keeps the handle-to-file mapping
 * in memory for one listing snapshot and rejects protected documents.
 * `relativePath` is display-only and `title` carries task metadata (possibly
 * empty); `group` only appears for observation items ("tongue" | "face").
 */
export interface NativeStorageItem {
  readonly id: string;
  readonly area: NativeStorageArea;
  readonly kind: NativeStorageItemKind;
  readonly role: NativeStorageRole;
  readonly byteLength: number;
  readonly deletable: boolean;
  readonly protectionCode?: NativeStorageProtectionCode;
  readonly title?: string;
  readonly group?: string;
  readonly relativePath: string;
}

export interface NativeStorageAreaItems {
  readonly schemaVersion: "native-storage.v2";
  readonly area: NativeStorageArea;
  readonly generatedAtEpochMs: number;
  readonly items: readonly NativeStorageItem[];
}

export interface NativeStorageCacheClearResult {
  readonly deletedCount: number;
  readonly failedCount: number;
  readonly freedBytes: number;
}

export interface StandaloneLocalStoragePlugin {
  inspect(): Promise<NativeStorageSnapshot>;
  /** The native side rejects `app-data`; its groups only appear in `inspect()`. */
  listAreaItems(options: { readonly area: NativeStorageArea }): Promise<NativeStorageAreaItems>;
  deleteItem(options: { readonly itemId: string }): Promise<void>;
  clearCache(): Promise<NativeStorageCacheClearResult>;
  /** Writes the report text to a file and opens the system share sheet. */
  exportReport(options: { readonly text: string }): Promise<void>;
}

export interface NativeProductionAsset {
  readonly id: string;
  readonly uri: NativeUri;
  readonly kind: "image" | "video" | "audio";
  readonly role?: "visual" | "avatar" | "music";
  readonly mimeType: string;
  readonly displayName: string;
  readonly sizeBytes: number;
  readonly durationSeconds?: number;
}

export interface NativeProductionResult {
  readonly uri: NativeUri;
  readonly mimeType: "video/mp4";
  readonly sizeBytes: number;
  readonly durationSeconds: number;
}

export interface NativeProductionProgressEvent {
  readonly projectId: string;
  /** 0..1 渲染进度。逐句配音事件按句子推进、没有整体百分比可报，此时省略而不是编造。 */
  readonly progress?: number;
  readonly stage: string;
  /** 逐句配音事件（stage = `synthesize_narration`）携带的句子定位，渲染阶段事件省略。 */
  readonly sentenceIndex?: number;
  readonly total?: number;
  readonly sentenceId?: string;
}

/** One sentence of a front-loaded narration synthesis request. */
export interface NativeNarrationSentenceInstruction {
  readonly sentenceId: string;
  readonly speechText: string;
  readonly needsTranscription?: boolean;
}

/** Where the native layer uploads finished sentence audio for Whisper word timings. */
export interface NativeNarrationTranscriptionInstruction {
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * One sentence's synthesis outcome. A success carries the measured duration, the project-relative
 * audio path and (when requested) raw transcribed words; a failure carries only a stable native
 * issue code so the shared layer can retry exactly that sentence.
 */
export interface NativeNarrationSentenceOutcome {
  readonly sentenceId: string;
  readonly durationMs?: number;
  readonly audioPath?: string;
  readonly transcribedWords: readonly { readonly word: string; readonly startMs: number; readonly endMs: number }[] | null;
  readonly error?: string;
}

export type NativeAssetOperationResult =
  | { readonly status: "none" }
  | { readonly status: "succeeded"; readonly projectId: string; readonly assets: readonly NativeProductionAsset[] }
  | { readonly status: "failed"; readonly code: string };

/** A private derivative frame. The URI never reaches the UI; only the AI transport resolves it. */
export interface NativeProductionInsightFrame {
  readonly uri: string;
  readonly mimeType: string;
}

export interface StandaloneProductionRuntimePlugin {
  pickAssets(options: { readonly projectId: string; readonly maxItems: number; readonly selection?: "visual" | "avatar" }): Promise<{ readonly assets: readonly NativeProductionAsset[] }>;
  consumeAssetOperation(): Promise<NativeAssetOperationResult>;
  render(options: {
    readonly projectId: string;
    readonly planJson: string;
    /** Resolved `subtitle-template.v1` object; required by `production-plan.v3`/`v4` plans only. */
    readonly subtitleTemplateJson?: string;
    readonly mode?: "montage" | "avatar";
    readonly narration?: "system" | "provider";
    readonly miMoInstruction?: string;
    readonly stepFunInstruction?: string;
    /**
     * Pre-synthesized sentence audio (project-relative paths) for the audio-ready v4 render path.
     * A non-empty list means the renderer consumes persisted narration and synthesizes nothing.
     */
    readonly narrationAssets?: readonly { readonly sentenceId: string; readonly audioPath: string }[];
  }): Promise<NativeProductionResult>;
  /**
   * Front-loaded narration stage: synthesize the given sentences, measure each audio file's real
   * duration and (when asked) transcribe it for word timings. One sentence failing never aborts
   * the rest; failures come back per sentence so exactly those can be retried.
   */
  synthesizeNarration(options: {
    readonly projectId: string;
    readonly mode: "montage" | "avatar";
    readonly narration: "system" | "provider";
    readonly speechRate?: number;
    /** Cloud narration requires both TTS instructions; system narration omits it. */
    readonly providerInstruction?: { readonly miMoInstruction: string; readonly stepFunInstruction: string };
    readonly sentences: readonly NativeNarrationSentenceInstruction[];
    /** Required when any sentence asks for transcription. */
    readonly transcriptionInstruction?: NativeNarrationTranscriptionInstruction;
  }): Promise<{ readonly sentences: readonly NativeNarrationSentenceOutcome[] }>;
  /** Runs a short non-personal synthesis request using the saved protected key. */
  probeTts(options: { readonly miMoInstruction: string; readonly stepFunInstruction: string }): Promise<void>;
  /**
   * Publishes bounded private JPEG derivatives of one asset for the vision model. Resolves with an
   * empty list when there is nothing to look at, which leaves the asset honestly undescribed.
   */
  insightFrames?(options: { readonly projectId: string; readonly assetId: string }): Promise<{
    readonly frames: readonly NativeProductionInsightFrame[];
  }>;
  addListener?(
    eventName: "productionProgress",
    listener: (event: NativeProductionProgressEvent) => void,
  ): Promise<NativeAiListenerHandle> | NativeAiListenerHandle;
}

export interface StandaloneNativeNetworkPlugin extends NativeTextFetchPort, NativeDownloadPort {
  startAiRequest(options: NativeAiRequestStart): Promise<NativeAiRequestStartResult>;
  addListener(
    eventName: "aiRequestEvent",
    listener: (event: NativeAiRequestEvent) => void,
  ): Promise<NativeAiListenerHandle> | NativeAiListenerHandle;
  addListener(
    eventName: "downloadProgress",
    listener: (event: NativeDownloadProgressEvent) => void,
  ): Promise<NativeDownloadListenerHandle> | NativeDownloadListenerHandle;
}

export interface StandaloneFileMediaPlugin {
  pickPhoto(): Promise<{ readonly uri: NativeUri; readonly mimeType?: string; readonly sizeBytes: number }>;
  pickVideo(options: { readonly taskId: string }): Promise<{
    readonly uri: NativeUri;
    readonly mimeType: "video/mp4";
    readonly displayName: string;
    readonly sizeBytes: number;
    readonly durationSeconds: number;
  }>;
  capturePhoto(): Promise<{ readonly uri: NativeUri; readonly mimeType?: string; readonly sizeBytes: number }>;
  consumePhotoOperation(): Promise<NativePhotoOperationResult>;
  consumeVideoOperation(): Promise<NativeVideoOperationResult>;
  copyFromUri(options: { readonly sourceUri: NativeUri; readonly displayName?: string }): Promise<{
    readonly uri: NativeUri;
    readonly mimeType?: string;
    readonly sizeBytes: number;
  }>;
}

export type NativeVideoOperationResult =
  | { readonly status: "none" }
  | {
      readonly status: "succeeded";
      readonly taskId: string;
      readonly uri: NativeUri;
      readonly mimeType: "video/mp4";
      readonly displayName: string;
      readonly sizeBytes: number;
      readonly durationSeconds: number;
    }
  | { readonly status: "failed"; readonly code: string };

export type NativePhotoOperationResult =
  | { readonly status: "none" }
  | {
      readonly status: "succeeded";
      readonly origin: "imported" | "captured";
      readonly uri: NativeUri;
      readonly mimeType?: string;
      readonly sizeBytes: number;
    }
  | { readonly status: "failed"; readonly code: string };

export type StandaloneMediaRuntimePlugin = NativeMediaPort;

/**
 * Minimal projection of `@capawesome-team/capacitor-android-foreground-service`
 * (plugin name "ForegroundService"). Declared locally so this package keeps a
 * narrow, version-stable contract instead of importing the vendor types.
 */
export interface StandaloneForegroundServicePlugin {
  startForegroundService(options: {
    readonly id: number;
    readonly title: string;
    readonly body: string;
    /** Drawable resource name for the status bar icon. */
    readonly smallIcon: string;
    readonly notificationChannelId?: string;
    /** Matches the plugin's Importance enum (1–5). */
    readonly importance?: number;
  }): Promise<void>;
  stopForegroundService(): Promise<void>;
  createNotificationChannel(options: {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly importance?: number;
  }): Promise<void>;
  checkPermissions(): Promise<{ readonly display: string }>;
  requestPermissions(): Promise<{ readonly display: string }>;
}

/** Self-written minimal bridge for wake-lock counting and battery guidance. */
export interface StandaloneTaskGuardPlugin {
  setBackgroundRunEnabled(options: { readonly enabled: boolean }): Promise<void>;
  holdWakeLock(options: { readonly kind: string }): Promise<{ readonly totalHolds: number }>;
  releaseWakeLock(options: { readonly kind: string }): Promise<{ readonly totalHolds: number }>;
  getBackgroundRunStatus(): Promise<{
    readonly batteryOptimizationIgnored: boolean;
    readonly wakeLockHolds: number;
  }>;
  requestIgnoreBatteryOptimizations(): Promise<{ readonly opened: string }>;
}

export interface StandaloneNativePlugins {
  readonly secureSettings: StandaloneSecureSettingsPlugin;
  readonly deviceSettings?: StandaloneDeviceSettingsPlugin;
  readonly localData: StandaloneLocalDataPlugin;
  readonly localFiles: StandaloneLocalFilesPlugin;
  readonly localStorage?: StandaloneLocalStoragePlugin;
  readonly nativeNetwork: StandaloneNativeNetworkPlugin;
  readonly fileMedia: StandaloneFileMediaPlugin;
  readonly mediaRuntime: StandaloneMediaRuntimePlugin;
  readonly productionRuntime?: StandaloneProductionRuntimePlugin;
  readonly taskGuard?: StandaloneTaskGuardPlugin;
  readonly foregroundService?: StandaloneForegroundServicePlugin;
}

export function registerStandaloneNativePlugins(registerPlugin: NativePluginRegistrar): StandaloneNativePlugins {
  return {
    secureSettings: registerPlugin<StandaloneSecureSettingsPlugin>("SecureSettings"),
    deviceSettings: registerPlugin<StandaloneDeviceSettingsPlugin>("DeviceSettings"),
    localData: registerPlugin<StandaloneLocalDataPlugin>("LocalData"),
    localFiles: registerPlugin<StandaloneLocalFilesPlugin>("LocalFiles"),
    localStorage: registerPlugin<StandaloneLocalStoragePlugin>("LocalStorage"),
    nativeNetwork: registerPlugin<StandaloneNativeNetworkPlugin>("NativeNetwork"),
    fileMedia: registerPlugin<StandaloneFileMediaPlugin>("FileMedia"),
    mediaRuntime: registerPlugin<StandaloneMediaRuntimePlugin>("MediaRuntime"),
    productionRuntime: registerPlugin<StandaloneProductionRuntimePlugin>("ProductionRuntime"),
    taskGuard: registerPlugin<StandaloneTaskGuardPlugin>("TaskGuard"),
    foregroundService: registerPlugin<StandaloneForegroundServicePlugin>("ForegroundService"),
  };
}
