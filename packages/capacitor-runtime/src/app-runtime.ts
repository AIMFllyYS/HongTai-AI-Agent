import { TaskError } from "@hongtai/core";
import type {
  AiAsrTransport,
  AiCapability,
  AiCapabilityProbeResult,
  AiConnectionPublicInput,
  AppRuntime,
  FeatureCapabilityRegistry,
  LocalProfile,
  MediaReference,
  ProfileUpdate,
  PublicAiConnectionConfig,
  TaskIssue,
} from "@hongtai/core";
import type { HongTaiNativePlugins, NativeAiConnection, NativeLocalProfile, NativeUri } from "./bridge.js";

export interface CreateCapacitorAppRuntimeOptions {
  /** Registered Capacitor plugins; supplied by the application shell, never React pages. */
  readonly plugins: HongTaiNativePlugins;
  /** Converts app-private native URIs into WebView-safe display URIs. */
  readonly convertFileSrc: (uri: NativeUri) => string;
  readonly now?: () => Date;
}

const CAPACITOR_FEATURES: FeatureCapabilityRegistry = Object.freeze({
  profile: "available",
  aiSettings: "available",
  ingest: "planned",
  contentAnalysis: "planned",
  diagnosis: "planned",
  create: "planned",
  assets: "planned",
  publish: "planned",
});

const PROBE_CAPABILITY_ORDER: readonly AiCapability[] = ["text", "vision", "asr"];
const LOCAL_PROFILE_ID = "local";

const NATIVE_STORAGE_ERROR_MAP = {
  ERR_SQLCIPHER_KEYSTORE_UNAVAILABLE: {
    code: "DATABASE_KEY_UNAVAILABLE",
    message: "本地加密密钥不可用，请勿清除应用数据后重试",
  },
  ERR_SQLCIPHER_KEY_MISSING: {
    code: "DATABASE_KEY_UNAVAILABLE",
    message: "检测到已有本地数据但加密密钥不可用，已保护原数据",
  },
  ERR_SQLCIPHER_KEY_MISMATCH: {
    code: "DATABASE_KEY_UNAVAILABLE",
    message: "本地加密密钥与已有数据不匹配，已保护原数据",
  },
  ERR_SQLCIPHER_MIGRATION_FAILED: {
    code: "DATABASE_MIGRATION_FAILED",
    message: "本地数据迁移未完成，原数据未被清除",
  },
  ERR_SQLCIPHER_INITIALIZATION_FAILED: {
    code: "DATABASE_OPEN_FAILED",
    message: "本地加密存储初始化失败",
  },
  ERR_SQLCIPHER_OPEN_FAILED: {
    code: "DATABASE_OPEN_FAILED",
    message: "本地加密存储当前不可用",
  },
  ERR_SQLCIPHER_DATA_CORRUPTED: {
    code: "DATABASE_OPEN_FAILED",
    message: "本地加密数据无法安全读取",
  },
} as const satisfies Readonly<Record<string, { readonly code: ConstructorParameters<typeof TaskError>[0]["code"]; readonly message: string }>>;

function taskError(
  code: ConstructorParameters<typeof TaskError>[0]["code"],
  message: string,
  action: ConstructorParameters<typeof TaskError>[0]["action"] = "none",
): TaskError {
  return new TaskError({ code, message, action });
}

function throwNativeStorageError(error: unknown, fallbackCode: ConstructorParameters<typeof TaskError>[0]["code"], fallbackMessage: string): never {
  const nativeCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
  const mapped = nativeCode && nativeCode in NATIVE_STORAGE_ERROR_MAP
    ? NATIVE_STORAGE_ERROR_MAP[nativeCode as keyof typeof NATIVE_STORAGE_ERROR_MAP]
    : undefined;
  if (mapped) throw new TaskError({ code: mapped.code, message: mapped.message, cause: error });
  throw new TaskError({ code: fallbackCode, message: fallbackMessage, cause: error });
}

function unavailableError(): TaskError {
  return taskError("APP_RUNTIME_UNAVAILABLE", "该本地应用能力尚未接入 Android 运行时");
}

function unavailableIssue(): TaskIssue {
  return {
    code: "APP_RUNTIME_UNAVAILABLE",
    severity: "error",
    userMessage: "该本地应用能力尚未接入 Android 运行时",
    retryable: false,
    action: "none",
  };
}

function ensureEpoch(value: number, code: ConstructorParameters<typeof TaskError>[0]["code"], message: string): number {
  if (!Number.isFinite(value) || value < 0) throw taskError(code, message);
  return value;
}

function isoFromEpoch(value: number, code: ConstructorParameters<typeof TaskError>[0]["code"], message: string): string {
  const epoch = ensureEpoch(value, code, message);
  try {
    return new Date(epoch).toISOString();
  } catch {
    throw taskError(code, message);
  }
}

function parseBusinessTags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new TypeError("business tags must be a string array");
    }
    return parsed;
  } catch {
    throw taskError("DATABASE_OPEN_FAILED", "本地档案标签无法读取");
  }
}

function normalizedOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validAsrTransport(value: string | null): AiAsrTransport {
  if (value == null || value === "" || value === "audio-transcriptions") return "audio-transcriptions";
  if (value === "chat-input-audio") return value;
  throw taskError("AI_SETTINGS_INVALID", "AI 设置中的 ASR 传输方式无效", "configure_ai");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedProbeResults(value: string): readonly AiCapabilityProbeResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录无法读取");
  }
  if (!Array.isArray(parsed)) throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录格式无效");
  const knownCapabilities = new Set<AiCapability>(PROBE_CAPABILITY_ORDER);
  const knownStatuses = new Set(["succeeded", "failed"] as const);
  const knownActions = new Set<TaskIssue["action"]>([
    "edit_input", "retry", "wait_and_retry", "check_network", "configure_ai", "free_storage", "select_media", "view_partial_result", "none",
  ]);
  return parsed.map((item): AiCapabilityProbeResult => {
    if (!isRecord(item) || typeof item.capability !== "string" || !knownCapabilities.has(item.capability as AiCapability)) {
      throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录包含未知能力");
    }
    if (typeof item.status !== "string" || !knownStatuses.has(item.status as "succeeded" | "failed")) {
      throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录状态无效");
    }
    if (typeof item.checkedAt !== "string" || Number.isNaN(Date.parse(item.checkedAt))) {
      throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录时间无效");
    }
    if (item.model !== null && typeof item.model !== "string") {
      throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测记录模型无效");
    }
    const issue = item.issue === undefined ? undefined : parsePersistedProbeIssue(item.issue, knownActions);
    return {
      capability: item.capability as AiCapability,
      status: item.status as AiCapabilityProbeResult["status"],
      checkedAt: item.checkedAt,
      model: item.model,
      ...(issue ? { issue } : {}),
    };
  });
}

function parsePersistedProbeIssue(value: unknown, knownActions: ReadonlySet<TaskIssue["action"]>): TaskIssue {
  if (!isRecord(value) || typeof value.code !== "string" || !value.code ||
      (value.severity !== "error" && value.severity !== "warning") ||
      typeof value.userMessage !== "string" || typeof value.retryable !== "boolean" ||
      typeof value.action !== "string" || !knownActions.has(value.action as TaskIssue["action"])) {
    throw taskError("DATABASE_OPEN_FAILED", "AI 能力探测错误记录无效");
  }
  return {
    code: value.code as TaskIssue["code"],
    severity: value.severity,
    userMessage: value.userMessage,
    retryable: value.retryable,
    action: value.action as TaskIssue["action"],
  };
}

class CapacitorApplicationRuntime {
  readonly #plugins: HongTaiNativePlugins;
  readonly #convertFileSrc: (uri: NativeUri) => string;
  readonly #now: () => Date;
  readonly #nativeUriByUiUri = new Map<string, string>();
  readonly #probeResults = new Map<AiCapability, AiCapabilityProbeResult>();

  constructor(options: CreateCapacitorAppRuntimeOptions) {
    this.#plugins = options.plugins;
    this.#convertFileSrc = options.convertFileSrc;
    this.#now = options.now ?? (() => new Date());
  }

  async create(): Promise<AppRuntime> {
    try {
      await this.#plugins.localData.initialize();
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "本地加密存储初始化失败");
    }

    return {
      profile: {
        get: () => this.#getProfile(),
        update: (input) => this.#updateProfile(input),
        pickAvatar: () => this.#pickPrivateImage(),
      },
      aiSettings: {
        getPublic: () => this.#getPublicAiConnection(),
        save: (input) => this.#savePublicAiConnection(input),
        replaceApiKey: (apiKey) => this.#replaceApiKey(apiKey),
        probe: (capability) => this.#probeAiCapability(capability),
        getProbeResults: () => this.#getProbeResults(),
      },
      tasks: {
        inspectInput: () => ({ ok: false, issue: unavailableIssue() }),
        create: async () => { throw unavailableError(); },
        start: async () => { throw unavailableError(); },
        get: async () => { throw unavailableError(); },
        getDetail: async () => { throw unavailableError(); },
        list: async () => { throw unavailableError(); },
        listEvents: async () => { throw unavailableError(); },
        subscribe: () => { throw unavailableError(); },
        cancel: async () => { throw unavailableError(); },
        retry: async () => { throw unavailableError(); },
      },
      analysis: {
        get: async () => { throw unavailableError(); },
        run: async () => { throw unavailableError(); },
      },
      diagnosis: {
        pickImage: async () => { throw unavailableError(); },
        createSession: async () => { throw unavailableError(); },
        runReport: async () => { throw unavailableError(); },
        getSession: async () => { throw unavailableError(); },
        listSessions: async () => { throw unavailableError(); },
        getReport: async () => { throw unavailableError(); },
        listMessages: async () => { throw unavailableError(); },
        followUp: async () => { throw unavailableError(); },
      },
      features: CAPACITOR_FEATURES,
    };
  }

  async #getProfile(): Promise<LocalProfile | undefined> {
    let nativeProfile: NativeLocalProfile | undefined;
    try {
      nativeProfile = (await this.#plugins.localData.getProfile()).profile;
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "本地档案无法读取");
    }
    return nativeProfile ? this.#toLocalProfile(nativeProfile) : undefined;
  }

  async #updateProfile(input: ProfileUpdate): Promise<LocalProfile> {
    let previous: NativeLocalProfile | undefined;
    try {
      previous = (await this.#plugins.localData.getProfile()).profile;
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "本地档案无法读取");
    }

    const displayName = normalizedOptional(input.displayName) ?? previous?.displayName;
    if (!displayName) {
      throw taskError("PROFILE_SAVE_FAILED", "首次保存本地档案需要填写显示名");
    }

    const nowEpochMs = this.#nowEpoch("PROFILE_SAVE_FAILED", "本地档案时间无效");
    const nativeProfile: NativeLocalProfile = {
      localProfileId: previous?.localProfileId ?? LOCAL_PROFILE_ID,
      remoteAccountId: previous?.remoteAccountId ?? null,
      displayName,
      avatarUri: input.avatarUri === undefined
        ? previous?.avatarUri ?? null
        : input.avatarUri === null ? null : this.#toNativeUri(input.avatarUri),
      businessName: input.businessName === undefined
        ? previous?.businessName ?? null
        : normalizedOptional(input.businessName),
      industry: input.industry === undefined
        ? previous?.industry ?? null
        : normalizedOptional(input.industry),
      businessTagsJson: JSON.stringify(input.businessTags ?? (previous ? parseBusinessTags(previous.businessTagsJson) : [])),
      createdAtEpochMs: previous?.createdAtEpochMs ?? nowEpochMs,
      updatedAtEpochMs: nowEpochMs,
    };

    try {
      await this.#plugins.localData.saveProfile(nativeProfile);
    } catch (error) {
      throwNativeStorageError(error, "PROFILE_SAVE_FAILED", "本地档案保存失败");
    }
    return this.#toLocalProfile(nativeProfile);
  }

  async #pickPrivateImage(): Promise<MediaReference> {
    try {
      const selected = await this.#plugins.fileMedia.pickPhoto();
      return {
        uri: this.#toUiUri(selected.uri),
        kind: "image",
        origin: "imported",
        mimeType: selected.mimeType,
        byteLength: selected.sizeBytes,
      };
    } catch {
      throw taskError("MEDIA_IMPORT_FAILED", "图片导入到本地私有存储失败", "select_media");
    }
  }

  async #getPublicAiConnection(): Promise<PublicAiConnectionConfig | undefined> {
    let connection: NativeAiConnection | undefined;
    try {
      connection = (await this.#plugins.localData.getAiConnection()).connection;
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "AI 设置无法读取");
    }
    if (!connection) return undefined;

    let hasApiKey: boolean;
    try {
      hasApiKey = (await this.#plugins.secureSettings.hasSecret({ slot: "active-ai-connection" })).exists;
    } catch {
      throw taskError("AI_SECRET_STORE_FAILED", "AI 密钥状态无法读取", "configure_ai");
    }
    return this.#toPublicAiConnection(connection, hasApiKey);
  }

  async #savePublicAiConnection(input: AiConnectionPublicInput): Promise<PublicAiConnectionConfig> {
    const baseUrl = input.baseUrl.trim();
    const textModel = normalizedOptional(input.textModel);
    if (!baseUrl || !textModel) {
      throw taskError("AI_SETTINGS_INVALID", "AI 设置需要 Base URL 和文本模型", "configure_ai");
    }

    let previous: NativeAiConnection | undefined;
    try {
      previous = (await this.#plugins.localData.getAiConnection()).connection;
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "AI 设置无法读取");
    }

    const nowEpochMs = this.#nowEpoch("AI_SETTINGS_INVALID", "AI 设置时间无效");
    const connection: NativeAiConnection = {
      connectionId: previous?.connectionId ?? "active",
      baseUrl,
      textModel,
      visionModel: normalizedOptional(input.visionModel),
      asrModel: normalizedOptional(input.asrModel),
      asrTransport: input.asrTransport,
      jsonObjectEnabled: input.supportsJsonObject,
      jsonSchemaEnabled: input.supportsJsonSchema,
      probeResultsJson: "[]",
      createdAtEpochMs: previous?.createdAtEpochMs ?? nowEpochMs,
      updatedAtEpochMs: nowEpochMs,
    };

    try {
      await this.#plugins.localData.saveAiConnection(connection);
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "AI 设置保存失败");
    }
    this.#probeResults.clear();

    let hasApiKey: boolean;
    try {
      hasApiKey = (await this.#plugins.secureSettings.hasSecret({ slot: "active-ai-connection" })).exists;
    } catch {
      throw taskError("AI_SECRET_STORE_FAILED", "AI 密钥状态无法读取", "configure_ai");
    }
    return this.#toPublicAiConnection(connection, hasApiKey);
  }

  async #replaceApiKey(apiKey: string): Promise<void> {
    const secret = apiKey.trim();
    if (!secret) throw taskError("AI_SETTINGS_INVALID", "API Key 不能为空", "configure_ai");
    try {
      await this.#plugins.secureSettings.writeSecret({ slot: "active-ai-connection", value: secret });
    } catch {
      throw taskError("AI_SECRET_STORE_FAILED", "API Key 无法写入安全存储", "configure_ai");
    }
  }

  async #probeAiCapability(capability: AiCapability): Promise<AiCapabilityProbeResult> {
    const connection = await this.#getPublicAiConnection();
    const nativeConnection = await this.#getNativeAiConnection("AI 设置无法读取");
    const model = connection ? this.#modelForCapability(connection, capability) : null;
    const issue = !connection
      ? this.#probeIssue("AI_NOT_CONFIGURED", "请先保存 AI 连接后再测试", "configure_ai")
      : !model
        ? this.#probeIssue("AI_SETTINGS_INVALID", "该能力尚未填写模型", "configure_ai")
        : this.#probeIssue("AI_CAPABILITY_PROBE_FAILED", "原生 AI 能力探测尚未接入", "none");
    const result: AiCapabilityProbeResult = {
      capability,
      status: "failed",
      checkedAt: this.#nowIso("AI_CAPABILITY_PROBE_FAILED", "AI 探测时间无效"),
      model,
      issue,
    };
    if (nativeConnection) {
      const nextResults = new Map(
        parsePersistedProbeResults(nativeConnection.probeResultsJson).map((saved) => [saved.capability, saved]),
      );
      nextResults.set(capability, result);
      const nextConnection: NativeAiConnection = {
        ...nativeConnection,
        probeResultsJson: JSON.stringify(PROBE_CAPABILITY_ORDER.flatMap((item) => {
          const saved = nextResults.get(item);
          return saved ? [saved] : [];
        })),
      };
      try {
        await this.#plugins.localData.saveAiConnection(nextConnection);
      } catch (error) {
        throwNativeStorageError(error, "DATABASE_OPEN_FAILED", "AI 能力探测记录无法保存");
      }
      this.#replaceProbeResults(nextResults.values());
    } else {
      this.#probeResults.set(capability, result);
    }
    return result;
  }

  async #getProbeResults(): Promise<readonly AiCapabilityProbeResult[]> {
    const connection = await this.#getNativeAiConnection("AI 能力探测记录无法读取");
    if (connection) this.#replaceProbeResults(parsePersistedProbeResults(connection.probeResultsJson));
    return PROBE_CAPABILITY_ORDER.flatMap((capability) => {
      const result = this.#probeResults.get(capability);
      return result ? [result] : [];
    });
  }

  #toLocalProfile(profile: NativeLocalProfile): LocalProfile {
    return {
      localProfileId: profile.localProfileId,
      remoteAccountId: profile.remoteAccountId,
      displayName: profile.displayName,
      avatarUri: profile.avatarUri ? this.#toUiUri(profile.avatarUri) : null,
      businessName: profile.businessName,
      industry: profile.industry,
      businessTags: parseBusinessTags(profile.businessTagsJson),
      createdAt: isoFromEpoch(profile.createdAtEpochMs, "DATABASE_OPEN_FAILED", "本地档案创建时间无效"),
      updatedAt: isoFromEpoch(profile.updatedAtEpochMs, "DATABASE_OPEN_FAILED", "本地档案更新时间无效"),
    };
  }

  #toPublicAiConnection(connection: NativeAiConnection, hasApiKey: boolean): PublicAiConnectionConfig {
    return {
      connectionId: connection.connectionId,
      baseUrl: connection.baseUrl,
      textModel: normalizedOptional(connection.textModel),
      visionModel: normalizedOptional(connection.visionModel),
      asrModel: normalizedOptional(connection.asrModel),
      asrTransport: validAsrTransport(connection.asrTransport),
      supportsJsonObject: connection.jsonObjectEnabled,
      supportsJsonSchema: connection.jsonSchemaEnabled,
      hasApiKey,
      createdAt: isoFromEpoch(connection.createdAtEpochMs, "DATABASE_OPEN_FAILED", "AI 设置创建时间无效"),
      updatedAt: isoFromEpoch(connection.updatedAtEpochMs, "DATABASE_OPEN_FAILED", "AI 设置更新时间无效"),
    };
  }

  async #getNativeAiConnection(fallbackMessage: string): Promise<NativeAiConnection | undefined> {
    try {
      return (await this.#plugins.localData.getAiConnection()).connection;
    } catch (error) {
      throwNativeStorageError(error, "DATABASE_OPEN_FAILED", fallbackMessage);
    }
  }

  #replaceProbeResults(results: Iterable<AiCapabilityProbeResult>): void {
    this.#probeResults.clear();
    for (const result of results) this.#probeResults.set(result.capability, result);
  }

  #toUiUri(nativeUri: string): string {
    let uiUri: string;
    try {
      uiUri = this.#convertFileSrc(nativeUri);
    } catch {
      throw taskError("MEDIA_READ_FAILED", "私有媒体无法转换为展示地址", "select_media");
    }
    if (!uiUri) throw taskError("MEDIA_READ_FAILED", "私有媒体无法转换为展示地址", "select_media");
    this.#nativeUriByUiUri.set(uiUri, nativeUri);
    return uiUri;
  }

  #toNativeUri(uiUri: string): string {
    const nativeUri = this.#nativeUriByUiUri.get(uiUri);
    if (!nativeUri) {
      throw taskError("MEDIA_READ_FAILED", "只能使用本应用已导入的私有媒体", "select_media");
    }
    return nativeUri;
  }

  #modelForCapability(connection: PublicAiConnectionConfig, capability: AiCapability): string | null {
    if (capability === "text") return connection.textModel;
    if (capability === "vision") return connection.visionModel;
    return connection.asrModel;
  }

  #probeIssue(
    code: ConstructorParameters<typeof TaskError>[0]["code"],
    userMessage: string,
    action: TaskIssue["action"],
  ): TaskIssue {
    return { code, severity: "error", userMessage, retryable: false, action };
  }

  #nowEpoch(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string): number {
    return ensureEpoch(this.#now().getTime(), code, message);
  }

  #nowIso(code: ConstructorParameters<typeof TaskError>[0]["code"], message: string): string {
    return isoFromEpoch(this.#nowEpoch(code, message), code, message);
  }
}

/**
 * Initializes the encrypted native data boundary, then exposes only the shared
 * AppRuntime contract to the application interface layer.
 */
export async function createCapacitorAppRuntime(options: CreateCapacitorAppRuntimeOptions): Promise<AppRuntime> {
  return new CapacitorApplicationRuntime(options).create();
}
