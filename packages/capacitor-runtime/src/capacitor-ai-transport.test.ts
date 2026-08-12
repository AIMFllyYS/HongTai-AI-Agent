import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleProvider } from "@hongtai/ai";

import { CapacitorAiTransport, NativeAiTransportError } from "./capacitor-ai-transport.js";

type NativeEvent = Readonly<Record<string, unknown>>;
type NativeRequest = Readonly<Record<string, unknown>>;

async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const chunk of chunks) result.push(chunk);
  return result;
}

function streamRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    version: "ai-transport.v1" as const,
    path: "chat/completions",
    method: "POST" as const,
    headers: { "Content-Type": "application/json", "X-Request-Source": "local-app" },
    body: {
      kind: "json" as const,
      json: JSON.stringify({ image: "transport://attachment/0" }),
      attachments: [{
        pointer: "/image",
        source: { kind: "uri" as const, uri: "file:///data/user/0/com.hongtai.aiagent/files/tasks/task-1/face.jpg" },
        mimeType: "image/jpeg",
        materialization: "data-url-base64" as const,
      }],
    },
    responseMode: "stream" as const,
    timeoutMs: 12_000,
    ...overrides,
  };
}

test("Capacitor AI transport forwards only a relative protocol request and returns native SSE chunks", async () => {
  let listener: ((event: NativeEvent) => void) | undefined;
  let listenerEventName = "";
  let started: NativeRequest | undefined;
  const nativeNetwork = {
    addListener: async (eventName: string, callback: (event: NativeEvent) => void) => {
      listenerEventName = eventName;
      listener = callback;
      return { remove: async () => undefined };
    },
    startAiRequest: async (options: NativeRequest) => {
      started = options;
      return {
        requestId: options.requestId,
        accepted: true,
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "X-Request-Id": "provider-request-1",
          "Set-Cookie": "must-not-reach-typescript",
        },
      };
    },
  };
  const transport = new CapacitorAiTransport({
    nativeNetwork: nativeNetwork as never,
    createRequestId: () => "native-ai-1",
  });

  const response = await transport.request(streamRequest());

  assert.equal(listenerEventName, "aiRequestEvent");
  assert.equal(started?.relativePath, "chat/completions");
  assert.equal(String(started?.relativePath).startsWith("/"), false);
  assert.equal("baseUrl" in (started ?? {}), false);
  assert.equal("apiKey" in (started ?? {}), false);
  assert.equal("authorization" in (started ?? {}), false);
  assert.equal(JSON.stringify(started).includes("must-not-cross-bridge"), false);
  assert.deepEqual(started?.headers, { "content-type": "application/json", "x-request-source": "local-app" });
  assert.equal(JSON.stringify(started).includes("/data/user/0/com.hongtai.aiagent/files/tasks/task-1/face.jpg"), true);
  assert.deepEqual(response.headers, {
    "content-type": "text/event-stream",
    "x-request-id": "provider-request-1",
  });
  assert.equal(response.body.kind, "stream");

  listener?.({ type: "chunk", requestId: "native-ai-1", sequence: 1, chunk: "data: first\n\n" });
  listener?.({ type: "chunk", requestId: "native-ai-1", sequence: 2, chunk: "data: second\n\n" });
  listener?.({ type: "completed", requestId: "native-ai-1", sequence: 3 });
  assert.deepEqual(await collect(response.body.kind === "stream" ? response.body.chunks : (async function* () {})()), [
    "data: first\n\n",
    "data: second\n\n",
  ]);
});

test("Capacitor AI transport waits for native JSON completion and maps native stream failure", async () => {
  let listener: ((event: NativeEvent) => void) | undefined;
  let notifyStart: (() => void) | undefined;
  const nativeStarted = new Promise<void>((resolve) => { notifyStart = resolve; });
  const nativeNetwork = {
    addListener: async (_eventName: string, callback: (event: NativeEvent) => void) => {
      listener = callback;
      return { remove: async () => undefined };
    },
    startAiRequest: async (options: NativeRequest) => {
      notifyStart?.();
      return {
        requestId: options.requestId,
        accepted: true,
        status: 200,
        headers: { "content-type": "application/json" },
      };
    },
  };
  const transport = new CapacitorAiTransport({
    nativeNetwork: nativeNetwork as never,
    createRequestId: (() => {
      let index = 0;
      return () => `native-ai-${++index}`;
    })(),
  });

  const jsonResponsePromise = transport.request({
    ...streamRequest(),
    responseMode: "json",
    body: { kind: "json", json: "{}" },
  });
  await nativeStarted;
  listener?.({
    type: "completed",
    requestId: "native-ai-1",
    sequence: 1,
    bodyText: JSON.stringify({ choices: [{ message: { content: "done" } }] }),
  });
  const jsonResponse = await jsonResponsePromise;
  assert.deepEqual(jsonResponse.body, {
    kind: "json",
    text: JSON.stringify({ choices: [{ message: { content: "done" } }] }),
  });

  const streamResponse = await transport.request(streamRequest());
  assert.equal(streamResponse.body.kind, "stream");
  listener?.({
    type: "failed",
    requestId: "native-ai-2",
    sequence: 1,
    code: "ERR_AI_NETWORK_FAILED",
    userMessage: "network unavailable",
    retryable: true,
  });
  await assert.rejects(
    () => collect(streamResponse.body.kind === "stream" ? streamResponse.body.chunks : (async function* () {})()),
    (error) => error instanceof NativeAiTransportError && error.code === "ERR_AI_NETWORK_FAILED" && error.retryable === true,
  );
});

test("shared OpenAI-compatible provider carries a native private image URI through the Capacitor transport", async () => {
  let listener: ((event: NativeEvent) => void) | undefined;
  let started: NativeRequest | undefined;
  let notifyStarted: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const nativeNetwork = {
    addListener: async (_eventName: string, callback: (event: NativeEvent) => void) => {
      listener = callback;
      return { remove: async () => undefined };
    },
    startAiRequest: async (options: NativeRequest) => {
      started = options;
      notifyStarted?.();
      return {
        requestId: options.requestId,
        accepted: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport: new CapacitorAiTransport({ nativeNetwork: nativeNetwork as never, createRequestId: () => "native-ai-provider" }),
    models: { vision: "vision-model" },
    supportsJsonObject: false,
    asrTransport: "audio-transcriptions",
    contextWindowTokens: 32_000,
    reasoningDialect: "generic",
    retryDelaysMs: [0],
  });

  const resultPromise = provider.generate({
    model: "vision",
    output: "text",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "observe" },
        { type: "image_uri", uri: "file:///data/user/0/com.hongtai.aiagent/files/tasks/task-1/face.jpg", mimeType: "image/jpeg" },
      ],
    }],
  });
  await startedPromise;
  const nativeBody = started?.body as { readonly kind?: string; readonly attachments?: readonly { readonly source?: { readonly uri?: string } }[] } | undefined;
  assert.equal(started?.relativePath, "chat/completions");
  assert.equal(nativeBody?.kind, "json");
  assert.equal(nativeBody?.attachments?.[0]?.source?.uri, "file:///data/user/0/com.hongtai.aiagent/files/tasks/task-1/face.jpg");
  listener?.({
    type: "chunk",
    requestId: "native-ai-provider",
    sequence: 1,
    chunk: 'data: {"choices":[{"delta":{"content":"native result"}}]}\n\n',
  });
  listener?.({ type: "completed", requestId: "native-ai-provider", sequence: 2 });

  assert.equal((await resultPromise).content, "native result");
});

test("Capacitor AI transport rejects credentials, absolute endpoints, and raw absolute attachment paths before native dispatch", async () => {
  let starts = 0;
  const nativeNetwork = {
    addListener: async () => ({ remove: async () => undefined }),
    startAiRequest: async () => {
      starts += 1;
      return { requestId: "unexpected", accepted: true, status: 200, headers: {} };
    },
  };
  const transport = new CapacitorAiTransport({ nativeNetwork: nativeNetwork as never, createRequestId: () => "native-ai-1" });

  await assert.rejects(
    () => transport.request(streamRequest({ path: "/chat/completions" })),
    /relative endpoint/,
  );
  await assert.rejects(
    () => transport.request(streamRequest({ headers: { Authorization: "Bearer must-not-cross-bridge" } })),
    /credential header/,
  );
  await assert.rejects(
    () => transport.request(streamRequest({ body: { kind: "json", json: '{"api_key":"must-not-cross-bridge"}' } })),
    /JSON body may not include credentials/,
  );
  await assert.rejects(
    () => transport.request(streamRequest({
      body: { kind: "json", json: '{"messages":[{"content":{"token":"must-not-cross-bridge"}}]}' },
    })),
    /JSON body may not include credentials/,
  );
  await assert.rejects(
    () => transport.request(streamRequest({
      body: {
        kind: "multipart",
        fields: { model: "asr" },
        file: {
          filename: "segment.wav",
          mimeType: "audio/wav",
          source: { kind: "uri", uri: "/data/user/0/com.hongtai.aiagent/files/tasks/task-1/segment.wav" },
        },
      },
      responseMode: "json",
    })),
    /private URI/,
  );
  assert.equal(starts, 0);
});

test("Capacitor AI transport accepts only app-private file URIs for native attachments", async () => {
  let starts = 0;
  const transport = new CapacitorAiTransport({
    nativeNetwork: {
      addListener: async () => ({ remove: async () => undefined }),
      startAiRequest: async () => {
        starts += 1;
        throw new Error("native dispatch should not run");
      },
    } as never,
    createRequestId: () => "native-ai-1",
  });

  await assert.rejects(
    () => transport.request(streamRequest({
      body: {
        kind: "multipart",
        fields: { model: "asr" },
        file: {
          filename: "segment.wav",
          mimeType: "audio/wav",
          source: { kind: "uri", uri: "content://media/external/audio/1" },
        },
      },
      responseMode: "json",
    })),
    /private URI/,
  );
  assert.equal(starts, 0);
});
