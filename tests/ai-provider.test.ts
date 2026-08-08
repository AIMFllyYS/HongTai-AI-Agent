import assert from "node:assert/strict";
import test from "node:test";
import { TaskError } from "../packages/core/src/index";
import {
  OpenAiCompatibleProvider,
  type AiStreamEvent,
  type AiTransport,
  type AiTransportRequest,
} from "../packages/ai/src/index";
import * as rootAi from "../packages/ai/src/index";
import { createNodeAiTransport, createNodeOpenAiCompatibleProvider } from "../packages/ai/src/node";

async function* rawChunks(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

test("Node-only factory restores Fetch credentials while the root AI entry exports no Fetch transport", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "node result" } }] }), { status: 200 });
  };
  try {
    const provider = createNodeOpenAiCompatibleProvider({
      baseUrl: "https://node.example/v1",
      apiKey: "node-secret",
      models: { text: "node-text" },
      supportsJsonObject: false,
      asrTransport: "audio-transcriptions",
      contextWindowTokens: 32_000,
      reasoningMode: "provider-default",
      retryDelaysMs: [0],
    });
    const result = await provider.generate({ model: "text", messages: [{ role: "user", content: "hello" }], output: "text" });
    assert.equal(result.content, "node result");
    assert.equal(requestUrl, "https://node.example/v1/chat/completions");
    assert.equal(authorization, "Bearer node-secret");
    assert.equal("FetchAiTransport" in rootAi, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Node Fetch transport rejects a native URI before attempting the network", async () => {
  let calls = 0;
  const transport = createNodeAiTransport({
    baseUrl: "https://node.example/v1",
    apiKey: "node-secret",
    fetchImpl: async () => {
      calls += 1;
      return new Response("unexpected", { status: 500 });
    },
  });

  await assert.rejects(
    () => transport.request({
      version: "ai-transport.v1",
      path: "chat/completions",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      responseMode: "json",
      body: {
        kind: "json",
        json: JSON.stringify({ image_url: { url: "transport://attachment/0" } }),
        attachments: [{
          pointer: "/image_url/url",
          source: { kind: "uri", uri: "content://media/external/images/72" },
          mimeType: "image/jpeg",
          materialization: "data-url-base64",
        }],
      },
    }),
    /cannot read a native media URI/,
  );
  assert.equal(calls, 0);
});

test("Node Fetch transport materializes raw audio and data-url image attachments deterministically", async () => {
  let requestBody = "";
  const transport = createNodeAiTransport({
    baseUrl: "https://node.example/v1",
    apiKey: "node-secret",
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
  });

  await transport.request({
    version: "ai-transport.v1",
    path: "chat/completions",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    responseMode: "json",
    body: {
      kind: "json",
      json: JSON.stringify({ audio: "transport://attachment/0", image: "transport://attachment/1" }),
      attachments: [
        {
          pointer: "/audio",
          source: { kind: "base64", base64: "AQID" },
          mimeType: "audio/wav",
          materialization: "raw-base64",
        },
        {
          pointer: "/image",
          source: { kind: "base64", base64: "AAAA" },
          mimeType: "image/jpeg",
          materialization: "data-url-base64",
        },
      ],
    },
  });

  assert.deepEqual(JSON.parse(requestBody), {
    audio: "AQID",
    image: "data:image/jpeg;base64,AAAA",
  });
});

test("OpenAI-compatible Provider sends relative stream DTOs to a custom transport without API Key", async () => {
  const requests: AiTransportRequest[] = [];
  const transport: AiTransport = {
    async request(request) {
      requests.push(request);
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: {
          kind: "stream",
          chunks: rawChunks([
            'data: {"choices":[{"delta":{"reasoning_content":"internal"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"visible"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport,
    models: { text: "text-model" },
    supportsJsonObject: true,
    supportsJsonSchema: true,
    asrTransport: "audio-transcriptions",
    contextWindowTokens: 32_000,
    reasoningMode: "provider-default",
    retryDelaysMs: [0],
  });

  const result = await provider.generate({
    model: "text",
    messages: [{ role: "user", content: "reply" }],
    output: "text",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "chat/completions");
  assert.equal(requests[0]?.responseMode, "stream");
  assert.equal("apiKey" in (requests[0] ?? {}), false);
  assert.equal(result.content, "visible");
  assert.equal(result.reasoning, "internal");
});

test("OpenAI-compatible Provider maps malformed raw SSE chunks to a stable error", async () => {
  const transport: AiTransport = {
    async request() {
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: { kind: "stream", chunks: rawChunks(["data: not-json\n\n"]) },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport,
    models: { text: "text-model" },
    supportsJsonObject: false,
    asrTransport: "audio-transcriptions",
    contextWindowTokens: 32_000,
    reasoningMode: "provider-default",
    retryDelaysMs: [0],
  });

  await assert.rejects(
    () => provider.generate({ model: "text", messages: [{ role: "user", content: "reply" }], output: "text" }),
    (error) => error instanceof TaskError && error.code === "AI_SERVER_ERROR",
  );
});

test("OpenAI-compatible Provider passes a native audio URI to a custom transcription transport", async () => {
  let received: AiTransportRequest | undefined;
  const transport: AiTransport = {
    async request(request) {
      received = request;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { kind: "json", text: JSON.stringify({ text: "native transcript" }) },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport,
    models: { asr: "asr-model" },
    supportsJsonObject: false,
    asrTransport: "audio-transcriptions",
    contextWindowTokens: 32_000,
    reasoningMode: "provider-default",
    retryDelaysMs: [0],
  });

  const result = await provider.transcribe({
    uri: "content://media/external/audio/42",
    filename: "segment.wav",
    mimeType: "audio/wav",
  });

  assert.equal(result, "native transcript");
  assert.equal(received?.path, "audio/transcriptions");
  assert.equal(received?.responseMode, "json");
  assert.deepEqual(received?.body, {
    kind: "multipart",
    fields: { model: "asr-model" },
    file: {
      filename: "segment.wav",
      mimeType: "audio/wav",
      source: { kind: "uri", uri: "content://media/external/audio/42" },
    },
  });
});

test("OpenAI-compatible Provider puts a visual native URI in a data-url attachment DTO", async () => {
  let received: AiTransportRequest | undefined;
  const transport: AiTransport = {
    async request(request) {
      received = request;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: {
          kind: "stream",
          chunks: rawChunks(['data: {"choices":[{"delta":{"content":"done"}}]}\n\n', "data: [DONE]\n\n"]),
        },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport,
    models: { vision: "vision-model" },
    supportsJsonObject: false,
    asrTransport: "audio-transcriptions",
    contextWindowTokens: 32_000,
    reasoningMode: "provider-default",
    retryDelaysMs: [0],
  });

  await provider.generate({
    model: "vision",
    output: "text",
    messages: [{ role: "user", content: [
      { type: "text", text: "analyze" },
      { type: "image_uri", uri: "content://media/external/images/72", mimeType: "image/jpeg" },
    ] }],
  });

  assert.equal(received?.body.kind, "json");
  const body = received?.body.kind === "json" ? JSON.parse(received.body.json) : undefined;
  assert.equal(body?.messages?.[0]?.content?.[1]?.image_url?.url, "transport://attachment/0");
  assert.deepEqual(received?.body.kind === "json" ? received.body.attachments : undefined, [{
    pointer: "/messages/0/content/1/image_url/url",
    source: { kind: "uri", uri: "content://media/external/images/72" },
    mimeType: "image/jpeg",
    materialization: "data-url-base64",
  }]);
});

test("OpenAI-compatible Provider uses raw-base64 materialization for chat audio URI attachments", async () => {
  let received: AiTransportRequest | undefined;
  const transport: AiTransport = {
    async request(request) {
      received = request;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { kind: "json", text: JSON.stringify({ choices: [{ message: { content: "audio transcript" } }] }) },
      };
    },
  };
  const provider = new OpenAiCompatibleProvider({
    transport,
    models: { asr: "asr-model" },
    supportsJsonObject: false,
    asrTransport: "chat-input-audio",
    contextWindowTokens: 32_000,
    reasoningMode: "provider-default",
    retryDelaysMs: [0],
  });

  const result = await provider.transcribe({
    uri: "content://media/external/audio/42",
    filename: "segment.wav",
    mimeType: "audio/wav",
  });

  assert.equal(result, "audio transcript");
  assert.equal(received?.body.kind, "json");
  const body = received?.body.kind === "json" ? JSON.parse(received.body.json) : undefined;
  assert.equal(body?.messages?.[0]?.content?.[0]?.input_audio?.data, "transport://attachment/0");
  assert.deepEqual(received?.body.kind === "json" ? received.body.attachments : undefined, [{
    pointer: "/messages/0/content/0/input_audio/data",
    source: { kind: "uri", uri: "content://media/external/audio/42" },
    mimeType: "audio/wav",
    materialization: "raw-base64",
  }]);
});

test("OpenAI兼容Provider使用自定义视觉模型并分离正文与reasoning流", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const stream = [
      'data: {"choices":[{"delta":{"reasoning_content":"分析图片"}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"schemaVersion\\":\\"test.v1\\"}"}}]}',
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":8},"choices":[]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  try {
    const provider = createNodeOpenAiCompatibleProvider({
      baseUrl: "https://custom.example/v1/",
      apiKey: "secret-key",
      models: { text: "text-model", vision: "vision-model", asr: "asr-model" },
      supportsJsonObject: true,
      supportsJsonSchema: true,
      asrTransport: "audio-transcriptions",
      contextWindowTokens: 32_000,
      reasoningMode: "provider-default",
      retryDelaysMs: [0],
    });
    const events: AiStreamEvent[] = [];
    const result = await provider.generate({
      model: "vision",
      messages: [{ role: "user", content: [
        { type: "text", text: "分析图片" },
        { type: "image_url", imageUrl: "data:image/jpeg;base64,AAAA" },
      ] }],
      output: "json",
      jsonSchema: {
        name: "test_result",
        strict: true,
        schema: {
          type: "object",
          properties: { schemaVersion: { type: "string" } },
          required: ["schemaVersion"],
          additionalProperties: false,
        },
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(requestUrl, "https://custom.example/v1/chat/completions");
    assert.equal(requestHeaders?.get("authorization"), "Bearer secret-key");
    assert.equal(requestHeaders?.has("x-mimo-source"), false);
    assert.equal(requestBody?.model, "vision-model");
    assert.deepEqual(requestBody?.response_format, {
      type: "json_schema",
      json_schema: {
        name: "test_result",
        strict: true,
        schema: {
          type: "object",
          properties: { schemaVersion: { type: "string" } },
          required: ["schemaVersion"],
          additionalProperties: false,
        },
      },
    });
    assert.equal(result.content, '{"schemaVersion":"test.v1"}');
    assert.equal(result.reasoning, "分析图片");
    assert.deepEqual(events.map((event) => event.type), ["reasoning_delta", "content_delta", "usage", "completed"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI兼容Provider在不支持JSON Schema时回退JSON Object", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  };
  try {
    const provider = createNodeOpenAiCompatibleProvider({
      baseUrl: "https://custom.example/v1",
      apiKey: "secret-key",
      models: { text: "text-model" },
      supportsJsonObject: true,
      supportsJsonSchema: false,
      asrTransport: "audio-transcriptions",
      contextWindowTokens: 32_000,
      reasoningMode: "provider-default",
      retryDelaysMs: [0],
    });
    await provider.generate({
      model: "text",
      messages: [{ role: "user", content: "输出JSON" }],
      output: "json",
      jsonSchema: { name: "test", schema: { type: "object" }, strict: true },
    });
    assert.deepEqual(requestBody?.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI兼容Provider使用标准音频转写端点", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let form: FormData | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    form = init?.body as FormData;
    return new Response(JSON.stringify({ text: "转写文本" }), { status: 200 });
  };
  try {
    const provider = createNodeOpenAiCompatibleProvider({
      baseUrl: "https://custom.example/v1",
      apiKey: "secret-key",
      models: { text: "text-model", vision: "vision-model", asr: "asr-model" },
      supportsJsonObject: false,
      asrTransport: "audio-transcriptions",
      contextWindowTokens: 32_000,
      reasoningMode: "provider-default",
      retryDelaysMs: [0],
    });
    const result = await provider.transcribe({ data: new Uint8Array([1, 2, 3]), filename: "part.wav", mimeType: "audio/wav" });
    assert.equal(requestUrl, "https://custom.example/v1/audio/transcriptions");
    assert.equal(form?.get("model"), "asr-model");
    assert.equal(result, "转写文本");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
