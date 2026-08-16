import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { OpenAiMediaClient, readNodeRuntimeConfig } from "../packages/node-runtime/src/index";
import { splitTranscriptRewriteChunks, TRANSCRIPT_REWRITE_CHUNK_SIZE, TRANSCRIPT_REWRITE_SYSTEM_PROMPT } from "../packages/ai/src/index";
import { TaskError } from "../packages/core/src/index";

const baseOptions = {
  baseUrl: "https://api.example/v1",
  apiKey: "test-secret",
  models: { asr: "asr-model", text: "text-model", vision: "vision-model" },
  supportsJsonObject: true,
  supportsJsonSchema: false,
  asrTransport: "chat-input-audio" as const,
  contextWindowTokens: 32_000,
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
    assert.equal((requests[1] as { messages?: { content?: string }[] })?.messages?.[0]?.content, TRANSCRIPT_REWRITE_SYSTEM_PROMPT);
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

test("CLI 文稿改写引用共享 Prompt 与切块，不再内联字面量", () => {
  const source = readFileSync(join(process.cwd(), "packages/node-runtime/src/transcript/openai-media-client.ts"), "utf8");
  assert.match(source, /TRANSCRIPT_REWRITE_SYSTEM_PROMPT/);
  assert.match(source, /splitTranscriptRewriteChunks/);
  assert.doesNotMatch(source, /你是短视频文稿整理助手/);
  assert.doesNotMatch(source, /#splitText/);
});

test("文稿改写切块在换行或句号处断开且不超过限额", () => {
  assert.deepEqual(splitTranscriptRewriteChunks("短稿"), ["短稿"]);
  const byLine = `${"甲".repeat(8_000)}\n${"乙".repeat(8_000)}`;
  const lineChunks = splitTranscriptRewriteChunks(byLine);
  assert.equal(lineChunks.length, 2);
  assert.equal(lineChunks[0], `${"甲".repeat(8_000)}\n`);
  assert.equal(lineChunks[1], "乙".repeat(8_000));
  const hard = "丙".repeat(TRANSCRIPT_REWRITE_CHUNK_SIZE + 1_000);
  const hardChunks = splitTranscriptRewriteChunks(hard);
  assert.equal(hardChunks[0]?.length, TRANSCRIPT_REWRITE_CHUNK_SIZE);
  assert.equal(hardChunks[1]?.length, 1_000);
});

test("文稿改写按共享切块分段并使用同一 Prompt", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: `块${requests.length}` } }] }), { status: 200 });
  };
  try {
    const client = new OpenAiMediaClient(baseOptions);
    const draft = await client.rewrite(`${"甲".repeat(8_000)}\n${"乙".repeat(8_000)}`);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal((request as { messages?: { content?: string }[] }).messages?.[0]?.content, TRANSCRIPT_REWRITE_SYSTEM_PROMPT);
    }
    assert.equal(draft, "块1\n\n块2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("运行配置没有默认供应商并允许按命令配置所需模型", () => {
  const names = [
    "HONGTAI_AI_BASE_URL", "HONGTAI_AI_API_KEY", "HONGTAI_TEXT_MODEL", "HONGTAI_VISION_MODEL", "HONGTAI_ASR_MODEL",
  ] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(readNodeRuntimeConfig().ai, undefined);
    process.env.HONGTAI_AI_BASE_URL = "https://api.example/v1";
    process.env.HONGTAI_AI_API_KEY = "secret";
    process.env.HONGTAI_TEXT_MODEL = "text-only-model";
    const config = readNodeRuntimeConfig();
    assert.equal(config.ai?.models.text, "text-only-model");
    assert.equal(config.ai?.models.vision, undefined);
  } finally {
    for (const name of names) {
      const value = saved[name];
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("运行配置拒绝缺少连接字段但不强迫无关模型", () => {
  const names = ["HONGTAI_AI_BASE_URL", "HONGTAI_AI_API_KEY", "HONGTAI_TEXT_MODEL", "HONGTAI_VISION_MODEL", "HONGTAI_ASR_MODEL"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
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
