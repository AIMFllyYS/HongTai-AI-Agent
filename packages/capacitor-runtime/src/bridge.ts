/**
 * Versioned contract between shared TypeScript application logic and the
 * app-local Capacitor plugins. Importing `registerPlugin` is intentionally left
 * to the app shell, keeping this package testable in Node and free of a web
 * runtime dependency.
 */
export const NATIVE_BRIDGE_PROTOCOL_VERSION = 1 as const;

export type NativePluginRegistrar = <T>(name: string) => T;
export type NativeUri = string;
export type NativeTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "degraded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SecureSettingsNativePlugin {
  writeSecret(options: { slot: "active-ai-connection"; value: string }): Promise<void>;
  hasSecret(options: { slot: "active-ai-connection" }): Promise<{ exists: boolean }>;
  removeSecret(options: { slot: "active-ai-connection" }): Promise<void>;
}

/** Public, encrypted-database DTO. It deliberately contains no API key. */
export interface NativeLocalProfile {
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

/** Public connection metadata from SQLCipher; the secret remains in Keystore. */
export interface NativeAiConnection {
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly textModel: string;
  readonly visionModel: string | null;
  readonly asrModel: string | null;
  readonly asrTransport: string | null;
  readonly jsonObjectEnabled: boolean;
  readonly jsonSchemaEnabled: boolean;
  /** JSON for public, per-capability probe states; never contains a secret. */
  readonly probeResultsJson: string;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
}

/** Narrow bridge for profile and public AI connection fields only. */
export interface LocalDataNativePlugin {
  initialize(): Promise<{ schemaVersion: number }>;
  getProfile(): Promise<{ profile?: NativeLocalProfile }>;
  saveProfile(options: NativeLocalProfile): Promise<void>;
  getAiConnection(): Promise<{ connection?: NativeAiConnection }>;
  saveAiConnection(options: NativeAiConnection): Promise<void>;
}

export interface NativeNetworkPlugin {
  getCapabilities(): Promise<{ download: "planned" | "available"; sse: "planned" | "available" }>;
  enqueueDownload(options: {
    taskId: string;
    sourceUrl: string;
    destinationRelativePath: string;
  }): Promise<{ taskId: string; accepted: boolean }>;
  openSseStream(options: {
    requestId: string;
    connectionId: string;
    relativePath: string;
    method: "POST";
    bodyUri?: NativeUri;
  }): Promise<void>;
}

export interface FileMediaPlugin {
  pickPhoto(): Promise<{ uri: NativeUri; mimeType?: string; sizeBytes: number }>;
  copyFromUri(options: { sourceUri: NativeUri; displayName?: string }): Promise<{
    uri: NativeUri;
    mimeType?: string;
    sizeBytes: number;
  }>;
}

export interface MediaRuntimePlugin {
  getCapabilities(): Promise<{
    transformer: "planned" | "available";
    mediaCodec: "planned" | "available";
  }>;
  probe(options: { uri: NativeUri }): Promise<{
    durationMs?: number;
    mimeType?: string;
    hasAudio?: boolean;
    hasVideo?: boolean;
  }>;
  extractPcmWav(options: { sourceUri: NativeUri; destinationRelativePath: string }): Promise<{
    uri: NativeUri;
  }>;
}

export interface TaskRuntimePlugin {
  startForegroundTask(options: { taskId: string; title: string; message: string }): Promise<void>;
  stopForegroundTask(options: { taskId: string }): Promise<void>;
  recoverInterruptedTasks(): Promise<{ taskIds: string[]; status: NativeTaskStatus }>;
}

export interface HongTaiNativePlugins {
  secureSettings: SecureSettingsNativePlugin;
  localData: LocalDataNativePlugin;
  nativeNetwork: NativeNetworkPlugin;
  fileMedia: FileMediaPlugin;
  mediaRuntime: MediaRuntimePlugin;
  taskRuntime: TaskRuntimePlugin;
}

export function registerHongTaiNativePlugins(
  registerPlugin: NativePluginRegistrar,
): HongTaiNativePlugins {
  return {
    secureSettings: registerPlugin<SecureSettingsNativePlugin>("SecureSettings"),
    localData: registerPlugin<LocalDataNativePlugin>("LocalData"),
    nativeNetwork: registerPlugin<NativeNetworkPlugin>("NativeNetwork"),
    fileMedia: registerPlugin<FileMediaPlugin>("FileMedia"),
    mediaRuntime: registerPlugin<MediaRuntimePlugin>("MediaRuntime"),
    taskRuntime: registerPlugin<TaskRuntimePlugin>("TaskRuntime"),
  };
}
