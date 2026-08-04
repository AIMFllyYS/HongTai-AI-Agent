import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TaskError } from "../packages/core/src/index";
import { NodeHttpClient, NodeMediaDownloader } from "../packages/node-runtime/src/index";

test("HTTP客户端对5xx有限重试后成功", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return attempts < 3 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
  };
  try {
    const response = await new NodeHttpClient({ retryDelaysMs: [0, 0, 0] }).get({ url: "https://example.com/item" });
    assert.equal(response.body, "ok");
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP客户端返回稳定的跳转超限错误码", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://example.com/again" } });
  try {
    await assert.rejects(
      () => new NodeHttpClient({ retryDelaysMs: [0] }).get({ url: "https://example.com/start", maxRedirects: 1 }),
      (error) => error instanceof TaskError && error.code === "LINK_REDIRECT_LIMIT",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("媒体下载遇到5xx会清理并从头重试", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-test-"));
  const destination = join(directory, "video.mp4");
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return attempts < 3
      ? new Response("busy", { status: 503 })
      : new Response(Buffer.from("video-data"), { status: 200, headers: { "content-length": "10" } });
  };
  try {
    await new NodeMediaDownloader({ retryDelaysMs: [0, 0, 0] }).download(
      { kind: "video", url: "https://media.example/video.mp4" },
      destination,
    );
    assert.equal((await readFile(destination)).toString(), "video-data");
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
