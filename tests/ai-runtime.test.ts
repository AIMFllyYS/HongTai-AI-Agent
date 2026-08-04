import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OpenAiMediaClient, readNodeRuntimeConfig } from "../packages/node-runtime/src/index";
import { TaskError } from "../packages/core/src/index";

const baseOptions = {
  baseUrl: "https://api.example/v1",
  apiKey: "test-secret",
  models: { asr: "asr-model", text: "text-model", vision: "vision-model" },
  supportsJsonObject: true,
  asrTransport: "chat-input-audio" as const,
  contextWindowTokens: 32_000,
  reasoningMode: "provider-default" as const,
  retryDelaysMs: [0],
};

test("通用媒体客户端使用聊天音频适配器并生成整理稿", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ai-runtime-"));
  const audioPath = join(directory, "segment.wav");
  await writeFile(audioPath, Buffer.from("RIFF-test-audio"));
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  let firstHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    firstHeaders ??= new Headers(init?.headers);
    requests.push(JSON.parse(String(init?.body)));
    const body = requests.length === 1 ? "语音转写结果" : "整理后的文稿";
    return new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), { status: 200 });
  };
  try {
    const client = new OpenAiMediaClient(baseOptions);
    const transcription = await client.transcribe([audioPath], 30);
    const draft = await client.rewrite(transcription.text);
    assert.equal(transcription.status, "transcribed");
    assert.equal(transcription.segments[0]?.text, "语音转写结果");
    assert.equal(draft, "整理后的文稿");
    assert.match(JSON.stringify(requests[0]), /input_audio/);
    assert.equal(firstHeaders?.has("x-mimo-source"), false);
    assert.doesNotMatch(JSON.stringify(requests), /test-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("通用媒体客户端保留无口播和错误映射", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ai-silence-"));
  const audioPath = join(directory, "segment.wav");
  await writeFile(audioPath, Buffer.from("RIFF-silence"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
  try {
    const client = new OpenAiMediaClient(baseOptions);
    const result = await client.transcribe([audioPath], 30);
    assert.equal(result.status, "no_speech");
    assert.equal(result.segments[0]?.status, "no_speech");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("通用媒体客户端把401映射为API Key错误", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), { status: 401 });
  };
  try {
    const client = new OpenAiMediaClient({ ...baseOptions, retryDelaysMs: [0, 0, 0] });
    await assert.rejects(() => client.rewrite("测试"), (error) => error instanceof TaskError && error.code === "AI_AUTH_INVALID");
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("运行配置没有默认供应商且要求显式模型", () => {
  const names = [
    "HONGTAI_AI_BASE_URL", "HONGTAI_AI_API_KEY", "HONGTAI_TEXT_MODEL", "HONGTAI_VISION_MODEL", "HONGTAI_ASR_MODEL",
  ] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(readNodeRuntimeConfig().ai, undefined);
    process.env.HONGTAI_AI_API_KEY = "secret";
    assert.throws(() => readNodeRuntimeConfig(), (error) => error instanceof TaskError && error.code === "AI_NOT_CONFIGURED");
  } finally {
    for (const name of names) {
      const value = saved[name];
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
