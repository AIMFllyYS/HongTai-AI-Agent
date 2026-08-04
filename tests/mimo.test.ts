import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MimoClient } from "../packages/node-runtime/src/index";
import { TaskError } from "../packages/core/src/index";

test("MiMo客户端使用专用音频消息并生成整理稿", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-mimo-test-"));
  const audioPath = join(directory, "segment.wav");
  await writeFile(audioPath, Buffer.from("RIFF-test-audio"));
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const body = requests.length === 1 ? "语音转写结果" : "整理后的文稿";
    return new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new MimoClient({
      baseUrl: "https://api.example/v1",
      apiKey: "test-secret",
      asrModel: "mimo-asr",
      textModel: "mimo-text",
    });
    const transcription = await client.transcribe([audioPath], 30);
    const draft = await client.rewrite(transcription.text);
    assert.equal(transcription.status, "transcribed");
    assert.equal(transcription.segments[0]?.text, "语音转写结果");
    assert.equal(draft, "整理后的文稿");
    assert.match(JSON.stringify(requests[0]), /input_audio/);
    assert.doesNotMatch(JSON.stringify(requests), /test-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("MiMo成功返回空文本时识别为无口播", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-mimo-silence-"));
  const audioPath = join(directory, "segment.wav");
  await writeFile(audioPath, Buffer.from("RIFF-silence"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
  try {
    const client = new MimoClient({ baseUrl: "https://api.example/v1", apiKey: "test", asrModel: "asr", textModel: "text", retryDelaysMs: [0] });
    const result = await client.transcribe([audioPath], 30);
    assert.equal(result.status, "no_speech");
    assert.equal(result.segments[0]?.status, "no_speech");
    assert.equal(result.segments[0]?.issue, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("MiMo响应缺少文本字段时保留AI_EMPTY_RESPONSE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-mimo-malformed-"));
  const audioPath = join(directory, "segment.wav");
  await writeFile(audioPath, Buffer.from("RIFF-malformed"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 });
  try {
    const client = new MimoClient({ baseUrl: "https://api.example/v1", apiKey: "test", asrModel: "asr", textModel: "text", retryDelaysMs: [0] });
    const result = await client.transcribe([audioPath], 30);
    assert.equal(result.status, "failed");
    assert.equal(result.segments[0]?.issue?.code, "AI_EMPTY_RESPONSE");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("MiMo 401映射为API Key错误且不重试", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), { status: 401 });
  };
  try {
    const client = new MimoClient({ baseUrl: "https://api.example/v1", apiKey: "bad", asrModel: "asr", textModel: "text", retryDelaysMs: [0, 0, 0] });
    await assert.rejects(() => client.rewrite("测试"), (error) => error instanceof TaskError && error.code === "AI_AUTH_INVALID");
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MiMo额度耗尽与普通限流使用不同错误码", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "quota exhausted" } }), { status: 429 });
  try {
    const client = new MimoClient({ baseUrl: "https://api.example/v1", apiKey: "test", asrModel: "asr", textModel: "text", retryDelaysMs: [0, 0, 0] });
    await assert.rejects(() => client.rewrite("测试"), (error) => error instanceof TaskError && error.code === "AI_QUOTA_EXHAUSTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
