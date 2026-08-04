import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MimoClient } from "../packages/node-runtime/src/index";

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
    const segments = await client.transcribe([audioPath], 30);
    const draft = await client.rewrite(segments[0]?.text ?? "");
    assert.equal(segments[0]?.text, "语音转写结果");
    assert.equal(draft, "整理后的文稿");
    assert.match(JSON.stringify(requests[0]), /input_audio/);
    assert.doesNotMatch(JSON.stringify(requests), /test-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
