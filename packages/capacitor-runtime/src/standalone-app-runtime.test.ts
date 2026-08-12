import assert from "node:assert/strict";
import test from "node:test";

import { createStandaloneAppRuntime } from "./standalone-app-runtime.js";
import type { StandaloneAiConnection, StandaloneLocalProfile } from "./standalone-bridge.js";

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

test("standalone runtime exposes local profile and write-only AI settings without initializing a database", async () => {
  let profile: StandaloneLocalProfile | undefined;
  let connection: StandaloneAiConnection | undefined;
  let secret = "";
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: {
        writeSecret: async ({ value }) => { secret = value; },
        hasSecret: async () => ({ exists: Boolean(secret) }),
        removeSecret: async () => { secret = ""; },
      },
      localData: {
        getProfile: async () => ({ ...(profile ? { profile } : {}) }),
        saveProfile: async (value) => { profile = value; },
        getAiConnection: async () => ({ ...(connection ? { connection } : {}) }),
        saveAiConnection: async (value) => { connection = value; },
        compareAndSetAiProbeResults: async () => ({ applied: true }),
      },
      localFiles: {
        listTaskIds: async () => ({ taskIds: [] }),
        listObservationIds: async () => ({ sessionIds: [] }),
        listProductionIds: async () => ({ projectIds: [] }),
      } as never,
      nativeNetwork: {} as never,
      fileMedia: { pickPhoto: async () => ({ uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 }), capturePhoto: async () => ({ uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 }), consumePhotoOperation: async () => ({ status: "none" }), copyFromUri: async () => ({ uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 }) },
      mediaRuntime: {} as never,
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const savedProfile = await runtime.profile.update({ displayName: "宏泰门店", businessTags: ["咖啡"] });
  const savedConnection = await runtime.aiSettings.save({
    baseUrl: "https://provider.example/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    asrModel: "asr-model",
    asrTransport: "audio-transcriptions",
    supportsJsonObject: true,
    supportsJsonSchema: true,
  });
  await runtime.aiSettings.replaceApiKey("not-returned-to-react");

  assert.equal(savedProfile.displayName, "宏泰门店");
  assert.deepEqual(savedProfile.businessTags, ["咖啡"]);
  assert.equal(savedConnection.hasApiKey, false);
  assert.equal((await runtime.aiSettings.getPublic())?.hasApiKey, true);
  assert.equal(secret, "not-returned-to-react");
  assert.equal(JSON.stringify(connection).includes("not-returned-to-react"), false);
  assert.equal(runtime.features.ingest, "available");
  assert.deepEqual(await runtime.recovery.inspectUnfinishedWork(), []);
});

test("cloud TTS remains in the AI connection and probes through the native renderer", async () => {
  let connection: StandaloneAiConnection | undefined;
  let secret = "";
  let ttsProbeCalls = 0;
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: {
        writeSecret: async ({ value }) => { secret = value; },
        hasSecret: async () => ({ exists: Boolean(secret) }),
        removeSecret: async () => { secret = ""; },
      },
      localData: {
        getProfile: async () => ({}),
        saveProfile: async () => undefined,
        getAiConnection: async () => ({ ...(connection ? { connection } : {}) }),
        saveAiConnection: async (value) => { connection = value; },
        compareAndSetAiProbeResults: async (value) => {
          if (connection) connection = { ...connection, probeResultsJson: value.probeResultsJson, updatedAtEpochMs: value.updatedAtEpochMs };
          return { applied: true };
        },
      },
      localFiles: {} as never,
      nativeNetwork: {} as never,
      fileMedia: {} as never,
      mediaRuntime: {} as never,
      productionRuntime: {
        pickAssets: async () => ({ assets: [] }),
        render: async () => ({ uri: "file:///private/output.mp4", mimeType: "video/mp4", sizeBytes: 1, durationSeconds: 1 }),
        probeTts: async () => { ttsProbeCalls += 1; },
      },
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  });

  await runtime.aiSettings.save({
    baseUrl: "https://api.xiaomimimo.com/v1",
    textModel: "mimo-v2.5",
    visionModel: "mimo-v2.5",
    asrModel: "mimo-v2.5-asr",
    asrTransport: "chat-input-audio",
    ttsModel: "mimo-v2.5-tts",
    ttsTransport: "mimo-chat-audio",
    ttsVoice: "冰糖",
    supportsJsonObject: true,
    supportsJsonSchema: true,
  });
  await runtime.aiSettings.replaceApiKey("write-only-key");
  const result = await runtime.aiSettings.probe("tts");

  assert.equal(result.status, "succeeded");
  assert.equal(result.model, "mimo-v2.5-tts");
  assert.equal(ttsProbeCalls, 1);
  assert.equal(connection?.ttsTransport, "mimo-chat-audio");
  assert.equal(JSON.stringify(connection).includes("write-only-key"), false);
});

test("profile saves the private avatar URI once and returns a display URI to the page", async () => {
  let profile: StandaloneLocalProfile | undefined;
  let copyCalls = 0;
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: { writeSecret: async () => undefined, hasSecret: async () => ({ exists: false }), removeSecret: async () => undefined },
      localData: {
        getProfile: async () => ({ ...(profile ? { profile } : {}) }),
        saveProfile: async (value) => { profile = value; },
        getAiConnection: async () => ({}),
        saveAiConnection: async () => undefined,
        compareAndSetAiProbeResults: async () => ({ applied: true }),
      },
      localFiles: {} as never,
      nativeNetwork: {} as never,
      fileMedia: {
        pickPhoto: async () => ({ uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 }),
        capturePhoto: async () => ({ uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 }),
        consumePhotoOperation: async () => ({ status: "none" }),
        copyFromUri: async () => {
          copyCalls += 1;
          return { uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 };
        },
      },
      mediaRuntime: {} as never,
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  const picked = await runtime.profile.pickAvatar();
  const saved = await runtime.profile.update({ displayName: "Avatar user", avatarUri: picked.uri });
  assert.equal(profile?.avatarUri, "file:///private/avatar.jpg");
  assert.equal(saved.avatarUri, "capacitor://localhost/private/avatar.jpg");
  assert.equal(copyCalls, 0, "the Android picker already imported the image into private storage");

  const loaded = await runtime.profile.get();
  assert.equal(loaded?.avatarUri, "capacitor://localhost/private/avatar.jpg");
  await runtime.profile.update({ displayName: "Avatar user", avatarUri: loaded?.avatarUri ?? null });
  assert.equal(profile?.avatarUri, "file:///private/avatar.jpg");
});

test("profile picker is visible to unified recovery only while its external Activity is active", async () => {
  const entered = deferred();
  const release = deferred();
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: { writeSecret: async () => undefined, hasSecret: async () => ({ exists: false }), removeSecret: async () => undefined },
      localData: {
        getProfile: async () => ({}), saveProfile: async () => undefined,
        getAiConnection: async () => ({}), saveAiConnection: async () => undefined,
        compareAndSetAiProbeResults: async () => ({ applied: true }),
      },
      localFiles: {
        listTaskIds: async () => ({ taskIds: [] }),
        listObservationIds: async () => ({ sessionIds: [] }),
        listProductionIds: async () => ({ projectIds: [] }),
      } as never,
      nativeNetwork: {} as never,
      fileMedia: {
        pickPhoto: async () => {
          entered.resolve();
          await release.promise;
          return { uri: "file:///private/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1 };
        },
      } as never,
      mediaRuntime: {} as never,
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
  });

  const picking = runtime.profile.pickAvatar();
  await entered.promise;
  assert.deepEqual(await runtime.recovery.inspectUnfinishedWork(), [{
    kind: "transient-operation",
    id: "profile-avatar",
    source: "memory",
    execution: "external-activity",
  }]);
  release.resolve();
  await picking;
  assert.deepEqual(await runtime.recovery.inspectUnfinishedWork(), []);
});

test("ASR probe sends a structurally valid WAV fixture through the native transport", async () => {
  let connection: StandaloneAiConnection | undefined;
  let secret = "";
  let listener: ((event: never) => void) | undefined;
  let nativeRequest: Readonly<Record<string, unknown>> | undefined;
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: {
        writeSecret: async ({ value }) => { secret = value; },
        hasSecret: async () => ({ exists: Boolean(secret) }),
        removeSecret: async () => { secret = ""; },
      },
      localData: {
        getProfile: async () => ({}),
        saveProfile: async () => undefined,
        getAiConnection: async () => ({ ...(connection ? { connection } : {}) }),
        saveAiConnection: async (value) => { connection = value; },
        compareAndSetAiProbeResults: async (value) => {
          if (connection) connection = { ...connection, probeResultsJson: value.probeResultsJson, updatedAtEpochMs: value.updatedAtEpochMs };
          return { applied: true };
        },
      },
      localFiles: {} as never,
      nativeNetwork: {
        addListener: async (_eventName: string, callback: (event: never) => void) => {
          listener = callback;
          return { remove: async () => undefined };
        },
        startAiRequest: async (request: Readonly<Record<string, unknown>>) => {
          nativeRequest = request;
          queueMicrotask(() => listener?.({
            type: "completed",
            requestId: request.requestId,
            sequence: 1,
            bodyText: JSON.stringify({ text: "OK" }),
          } as never));
          return { requestId: request.requestId, accepted: true, status: 200, headers: { "content-type": "application/json" } };
        },
      } as never,
      fileMedia: {} as never,
      mediaRuntime: {} as never,
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  await runtime.aiSettings.save({
    baseUrl: "https://provider.example/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    asrModel: "asr-model",
    asrTransport: "audio-transcriptions",
    supportsJsonObject: true,
    supportsJsonSchema: true,
  });
  await runtime.aiSettings.replaceApiKey("probe-key");
  assert.equal((await runtime.aiSettings.probe("asr")).status, "succeeded");

  const file = (nativeRequest?.body as { readonly kind?: string; readonly file?: { readonly source?: { readonly kind?: string; readonly base64?: string } } } | undefined)?.file;
  assert.equal((nativeRequest?.body as { readonly kind?: string } | undefined)?.kind, "multipart");
  assert.equal(file?.source?.kind, "base64");
  const bytes = Buffer.from(file?.source?.base64 ?? "", "base64");
  assert.ok(bytes.length >= 46);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(bytes.subarray(36, 40).toString("ascii"), "data");
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
});

test("vision probe sends a provider-compatible synthetic image fixture", async () => {
  let connection: StandaloneAiConnection | undefined;
  let secret = "";
  let listener: ((event: never) => void) | undefined;
  let nativeRequest: Readonly<Record<string, unknown>> | undefined;
  const runtime = await createStandaloneAppRuntime({
    plugins: {
      secureSettings: {
        writeSecret: async ({ value }) => { secret = value; },
        hasSecret: async () => ({ exists: Boolean(secret) }),
        removeSecret: async () => { secret = ""; },
      },
      localData: {
        getProfile: async () => ({}),
        saveProfile: async () => undefined,
        getAiConnection: async () => ({ ...(connection ? { connection } : {}) }),
        saveAiConnection: async (value) => { connection = value; },
        compareAndSetAiProbeResults: async (value) => {
          if (connection) connection = { ...connection, probeResultsJson: value.probeResultsJson, updatedAtEpochMs: value.updatedAtEpochMs };
          return { applied: true };
        },
      },
      localFiles: {} as never,
      nativeNetwork: {
        addListener: async (_eventName: string, callback: (event: never) => void) => {
          listener = callback;
          return { remove: async () => undefined };
        },
        startAiRequest: async (request: Readonly<Record<string, unknown>>) => {
          nativeRequest = request;
          queueMicrotask(() => {
            listener?.({ type: "chunk", requestId: request.requestId, sequence: 1, chunk: 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n' } as never);
            listener?.({ type: "completed", requestId: request.requestId, sequence: 2 } as never);
          });
          return { requestId: request.requestId, accepted: true, status: 200, headers: { "content-type": "text/event-stream" } };
        },
      } as never,
      fileMedia: {} as never,
      mediaRuntime: {} as never,
    },
    convertFileSrc: (uri) => `capacitor://localhost/${uri.slice("file:///".length)}`,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });

  await runtime.aiSettings.save({
    baseUrl: "https://provider.example/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    asrModel: "asr-model",
    asrTransport: "audio-transcriptions",
    supportsJsonObject: true,
    supportsJsonSchema: true,
  });
  await runtime.aiSettings.replaceApiKey("probe-key");
  assert.equal((await runtime.aiSettings.probe("vision")).status, "succeeded");

  const body = nativeRequest?.body as {
    readonly kind?: string;
    readonly json?: string;
  } | undefined;
  const payload = JSON.parse(body?.json ?? "{}") as { readonly messages?: readonly { readonly content?: readonly { readonly image_url?: { readonly url?: string } }[] }[] };
  const imageUrl = payload.messages?.[0]?.content?.[1]?.image_url?.url;
  const encoded = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(imageUrl ?? "")?.[1] ?? "";
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(body?.kind, "json");
  assert.match(imageUrl ?? "", /^data:image\/jpeg;base64,/);
  assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
  assert.equal(bytes.length, 1_804, "fixture must retain its complete provider-tested JPEG payload");
  assert.equal(bytes.subarray(-2).toString("hex"), "ffd9");
  const startOfFrame = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(startOfFrame >= 0, "fixture must contain a baseline JPEG frame");
  assert.equal(bytes.readUInt16BE(startOfFrame + 5), 512, "fixture height must meet the verified provider minimum");
  assert.equal(bytes.readUInt16BE(startOfFrame + 7), 512, "fixture width must meet the verified provider minimum");
});
