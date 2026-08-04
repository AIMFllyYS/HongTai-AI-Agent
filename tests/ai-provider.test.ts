import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleProvider, type AiStreamEvent } from "../packages/ai/src/index";

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
    const provider = new OpenAiCompatibleProvider({
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
    const provider = new OpenAiCompatibleProvider({
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
    const provider = new OpenAiCompatibleProvider({
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
