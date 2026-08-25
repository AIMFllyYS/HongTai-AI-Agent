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

/**
 * Native storage inspection deliberately returns opaque delete handles rather
 * than paths.  The Android implementation keeps the handle-to-file mapping
 * in memory for one inspection snapshot and rejects protected documents.
 */
export interface NativeStorageItem {
  readonly id: string;
  readonly area: NativeStorageArea;
  readonly kind: NativeStorageItemKind;
  readonly role: NativeStorageRole;
  readonly byteLength: number;
  readonly deletable: boolean;
  readonly protectionCode?: NativeStorageProtectionCode;
}

export interface StandaloneLocalStoragePlugin {
  inspect(): Promise<{
    readonly schemaVersion: "native-storage.v1";
    readonly generatedAtEpochMs: number;
    readonly items: readonly NativeStorageItem[];
  }>;
  deleteItem(options: { readonly itemId: string }): Promise<void>;
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
  readonly progress: number;
  readonly stage: string;
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
    /** Resolved `subtitle-template.v1` object; required by `production-plan.v3` plans only. */
    readonly subtitleTemplateJson?: string;
    readonly mode?: "montage" | "avatar";
    readonly narration?: "system" | "provider";
    readonly miMoInstruction?: string;
    readonly stepFunInstruction?: string;
  }): Promise<NativeProductionResult>;
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
  };
}
