import type { LocalTaskFilesPlugin } from "./thin-task-files.js";
import type {
  NativeDownloadPort,
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

export type LocalFilesArea = "task" | "observation";

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
}

export interface StandaloneNativeNetworkPlugin extends NativeTextFetchPort, NativeDownloadPort {
  startAiRequest(options: NativeAiRequestStart): Promise<NativeAiRequestStartResult>;
  addListener(
    eventName: "aiRequestEvent",
    listener: (event: NativeAiRequestEvent) => void,
  ): Promise<NativeAiListenerHandle> | NativeAiListenerHandle;
}

export interface StandaloneFileMediaPlugin {
  pickPhoto(): Promise<{ readonly uri: NativeUri; readonly mimeType?: string; readonly sizeBytes: number }>;
  capturePhoto(): Promise<{ readonly uri: NativeUri; readonly mimeType?: string; readonly sizeBytes: number }>;
  copyFromUri(options: { readonly sourceUri: NativeUri; readonly displayName?: string }): Promise<{
    readonly uri: NativeUri;
    readonly mimeType?: string;
    readonly sizeBytes: number;
  }>;
}

export type StandaloneMediaRuntimePlugin = NativeMediaPort;

export interface StandaloneNativePlugins {
  readonly secureSettings: StandaloneSecureSettingsPlugin;
  readonly localData: StandaloneLocalDataPlugin;
  readonly localFiles: StandaloneLocalFilesPlugin;
  readonly nativeNetwork: StandaloneNativeNetworkPlugin;
  readonly fileMedia: StandaloneFileMediaPlugin;
  readonly mediaRuntime: StandaloneMediaRuntimePlugin;
}

export function registerStandaloneNativePlugins(registerPlugin: NativePluginRegistrar): StandaloneNativePlugins {
  return {
    secureSettings: registerPlugin<StandaloneSecureSettingsPlugin>("SecureSettings"),
    localData: registerPlugin<StandaloneLocalDataPlugin>("LocalData"),
    localFiles: registerPlugin<StandaloneLocalFilesPlugin>("LocalFiles"),
    nativeNetwork: registerPlugin<StandaloneNativeNetworkPlugin>("NativeNetwork"),
    fileMedia: registerPlugin<StandaloneFileMediaPlugin>("FileMedia"),
    mediaRuntime: registerPlugin<StandaloneMediaRuntimePlugin>("MediaRuntime"),
  };
}
