import assert from "node:assert/strict";
import test from "node:test";

import * as runtimeExports from "./index.js";

interface NativeProfile {
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

interface NativeConnection {
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

interface RuntimeForTest {
  readonly profile: {
    get(): Promise<NativeProfile | undefined>;
    update(input: { displayName?: string; avatarUri?: string | null; businessName?: string | null; industry?: string | null; businessTags?: readonly string[] }): Promise<NativeProfile>;
    pickAvatar(): Promise<{ uri: string; kind: string; origin: string; mimeType?: string; byteLength?: number }>;
  };
  readonly aiSettings: {
    getPublic(): Promise<{ connectionId: string; hasApiKey: boolean; textModel: string | null; asrTransport: string } | undefined>;
    save(input: { baseUrl: string; textModel: string | null; visionModel: string | null; asrModel: string | null; asrTransport: "audio-transcriptions" | "chat-input-audio"; supportsJsonObject: boolean; supportsJsonSchema: boolean }): Promise<{ hasApiKey: boolean; textModel: string | null }>;
    replaceApiKey(apiKey: string): Promise<void>;
    probe(capability: "text" | "vision" | "asr"): Promise<{ status: string; issue?: { code: string } }>;
    getProbeResults(): Promise<readonly { capability: string; status: string; issue?: { code: string } }[]>;
  };
  readonly features: Readonly<Record<string, string>>;
  readonly tasks: {
    inspectInput(input: string): { ok: boolean; issue?: { code: string } };
    getDetail(taskId: string): Promise<unknown>;
  };
  readonly analysis: { run(taskId: string): Promise<unknown> };
  readonly diagnosis: { runReport(sessionId: string): Promise<unknown>; listSessions(): Promise<unknown> };
}

type RuntimeFactory = (options: {
  readonly plugins: unknown;
  readonly convertFileSrc: (uri: string) => string;
  readonly now: () => Date;
}) => Promise<RuntimeForTest>;

const runtimeFactoryExports = runtimeExports as typeof runtimeExports & {
  readonly createCapacitorAppRuntime: RuntimeFactory;
};

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function createPlugins() {
  let profile: NativeProfile | undefined;
  let connection: NativeConnection | undefined;
  let secret: string | undefined;

  const plugins = {
    secureSettings: {
      writeSecret: async ({ value }: { readonly slot: string; readonly value: string }) => { secret = value; },
      hasSecret: async () => ({ exists: Boolean(secret) }),
      removeSecret: async () => { secret = undefined; },
    },
    localData: {
      initialize: async () => ({ schemaVersion: 1 }),
      getProfile: async () => ({ profile }),
      saveProfile: async (next: NativeProfile) => { profile = next; },
      getAiConnection: async () => ({ connection }),
      saveAiConnection: async (next: NativeConnection) => { connection = next; },
    },
    fileMedia: {
      pickPhoto: async () => ({ uri: "file:///private/media/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
      copyFromUri: async () => ({ uri: "file:///private/media/copied.jpg", mimeType: "image/jpeg", sizeBytes: 128 }),
    },
    nativeNetwork: {},
    mediaRuntime: {},
    taskRuntime: {},
  };

  return {
    plugins,
    profile: () => profile,
    connection: () => connection,
    secret: () => secret,
  };
}

test("Capacitor runtime stores public local settings while keeping secrets and private URIs out of React", async () => {
  assert.equal(typeof runtimeFactoryExports.createCapacitorAppRuntime, "function");

  const native = createPlugins();
  const now = new Date("2026-08-07T10:20:30.000Z");
  const runtime = await runtimeFactoryExports.createCapacitorAppRuntime({
    plugins: native.plugins,
    convertFileSrc: (uri) => `capacitor://localhost/_capacitor_file_/${uri.slice("file:///".length)}`,
    now: () => now,
  });

  assert.equal(await runtime.profile.get(), undefined);
  const avatar = await runtime.profile.pickAvatar();
  assert.deepEqual(avatar, {
    uri: "capacitor://localhost/_capacitor_file_/private/media/avatar.jpg",
    kind: "image",
    origin: "imported",
    mimeType: "image/jpeg",
    byteLength: 128,
  });

  const savedProfile = await runtime.profile.update({
    displayName: "宏泰门店",
    avatarUri: avatar.uri,
    businessName: "宏泰健康",
    industry: "健康服务",
    businessTags: ["本地", "体验"],
  });
  assert.equal(savedProfile.avatarUri, avatar.uri);
  assert.equal(native.profile()?.avatarUri, "file:///private/media/avatar.jpg");
  assert.equal(native.profile()?.businessTagsJson, "[\"本地\",\"体验\"]");
  assert.equal(native.profile()?.createdAtEpochMs, now.getTime());

  const savedConnection = await runtime.aiSettings.save({
    baseUrl: "https://example.invalid/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    asrModel: "asr-model",
    asrTransport: "audio-transcriptions",
    supportsJsonObject: true,
    supportsJsonSchema: false,
  });
  assert.equal(savedConnection.hasApiKey, false);
  assert.equal(native.connection()?.textModel, "text-model");
  assert.equal(native.connection()?.createdAtEpochMs, now.getTime());

  await runtime.aiSettings.replaceApiKey("unit-test-api-key");
  assert.equal(native.secret(), "unit-test-api-key");
  assert.equal(JSON.stringify(native.connection()).includes("unit-test-api-key"), false);
  const publicConfig = await runtime.aiSettings.getPublic();
  assert.equal(publicConfig?.hasApiKey, true);
  assert.equal(JSON.stringify(publicConfig).includes("unit-test-api-key"), false);
  assert.equal(native.connection()?.probeResultsJson, "[]");
});

test("Capacitor runtime keeps unimplemented services honest and records a stable probe failure", async () => {
  assert.equal(typeof runtimeFactoryExports.createCapacitorAppRuntime, "function");

  const native = createPlugins();
  const runtime = await runtimeFactoryExports.createCapacitorAppRuntime({
    plugins: native.plugins,
    convertFileSrc: (uri) => uri,
    now: () => new Date("2026-08-07T10:20:30.000Z"),
  });

  assert.deepEqual(runtime.features, {
    profile: "available",
    aiSettings: "available",
    ingest: "planned",
    contentAnalysis: "planned",
    diagnosis: "planned",
    create: "planned",
    assets: "planned",
    publish: "planned",
  });

  const probe = await runtime.aiSettings.probe("vision");
  assert.equal(probe.status, "failed");
  assert.equal(probe.issue?.code, "AI_NOT_CONFIGURED");
  const probeResults = await runtime.aiSettings.getProbeResults();
  assert.equal(probeResults.length, 1);
  assert.equal(probeResults[0]?.capability, "vision");
  assert.equal(probeResults[0]?.status, "failed");
  assert.equal(probeResults[0]?.issue?.code, "AI_NOT_CONFIGURED");

  assert.equal(runtime.tasks.inspectInput("https://v.douyin.com/example").issue?.code, "APP_RUNTIME_UNAVAILABLE");
  await assert.rejects(() => runtime.tasks.getDetail("task-1"), hasCode("APP_RUNTIME_UNAVAILABLE"));
  await assert.rejects(() => runtime.analysis.run("task-1"), hasCode("APP_RUNTIME_UNAVAILABLE"));
  await assert.rejects(() => runtime.diagnosis.runReport("session-1"), hasCode("APP_RUNTIME_UNAVAILABLE"));
  await assert.rejects(() => runtime.diagnosis.listSessions(), hasCode("APP_RUNTIME_UNAVAILABLE"));
});

test("Capacitor runtime persists independent public AI probe outcomes with its connection", async () => {
  const native = createPlugins();
  const runtime = await runtimeFactoryExports.createCapacitorAppRuntime({
    plugins: native.plugins,
    convertFileSrc: (uri) => uri,
    now: () => new Date("2026-08-07T10:20:30.000Z"),
  });
  await runtime.aiSettings.save({
    baseUrl: "https://example.invalid/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    asrModel: "asr-model",
    asrTransport: "audio-transcriptions",
    supportsJsonObject: false,
    supportsJsonSchema: false,
  });

  const result = await runtime.aiSettings.probe("vision");
  assert.equal(result.issue?.code, "AI_CAPABILITY_PROBE_FAILED");
  assert.equal(native.connection()?.probeResultsJson.includes("AI_CAPABILITY_PROBE_FAILED"), true);
  assert.equal(native.connection()?.probeResultsJson.includes("sk-"), false);

  const reopened = await runtimeFactoryExports.createCapacitorAppRuntime({
    plugins: native.plugins,
    convertFileSrc: (uri) => uri,
    now: () => new Date("2026-08-07T10:20:30.000Z"),
  });
  const persisted = await reopened.aiSettings.getProbeResults();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.capability, "vision");
});

test("Capacitor runtime preserves native SQLCipher failure codes and rejects untrusted display URIs", async () => {
  const native = createPlugins();
  native.plugins.localData.initialize = async () => {
    throw Object.assign(new Error("missing protected key"), { code: "ERR_SQLCIPHER_KEY_MISSING" });
  };

  await assert.rejects(
    () => runtimeFactoryExports.createCapacitorAppRuntime({
      plugins: native.plugins,
      convertFileSrc: (uri) => uri,
      now: () => new Date("2026-08-07T10:20:30.000Z"),
    }),
    hasCode("DATABASE_KEY_UNAVAILABLE"),
  );

  const validNative = createPlugins();
  const runtime = await runtimeFactoryExports.createCapacitorAppRuntime({
    plugins: validNative.plugins,
    convertFileSrc: (uri) => uri,
    now: () => new Date("2026-08-07T10:20:30.000Z"),
  });
  await assert.rejects(
    () => runtime.profile.update({ displayName: "宏泰", avatarUri: "file:///untrusted/private.jpg" }),
    hasCode("MEDIA_READ_FAILED"),
  );
});
