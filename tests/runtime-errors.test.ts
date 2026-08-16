import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  Agent,
  fetch as undiciFetch,
  getGlobalDispatcher,
  MockAgent,
  RetryAgent,
  setGlobalDispatcher,
} from "undici";
import { TaskError } from "../packages/core/src/index";
import { assertDownloadedLength, NodeHttpClient, NodeMediaDownloader, replaceDownloadedFile } from "../packages/node-runtime/src/index";

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

test("HTTP客户端仅在显式授权时重试可重放POST", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method?: string; body?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({ method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    return requests.length === 1 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
  };
  try {
    const response = await new NodeHttpClient({ retryDelaysMs: [0, 0, 0] }).post({
      url: "https://example.com/graphql",
      body: JSON.stringify({ operationName: "ReadOnlyQuery" }),
      headers: { "Content-Type": "application/json" },
      maxAttempts: 2,
    });
    assert.equal(response.body, "ok");
    assert.deepEqual(requests, [
      { method: "POST", body: '{"operationName":"ReadOnlyQuery"}' },
      { method: "POST", body: '{"operationName":"ReadOnlyQuery"}' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP客户端POST默认只发送一次", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("busy", { status: 503 });
  };
  try {
    await assert.rejects(
      () => new NodeHttpClient({ retryDelaysMs: [0, 0, 0] }).post({
        url: "https://example.com/graphql",
        body: "{}",
      }),
      (error) => error instanceof TaskError && error.code === "PLATFORM_API_UNAVAILABLE",
    );
    assert.equal(attempts, 1);
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

test("Undici在响应体中断后使用Range续传剩余字节", async (context) => {
  const content = Buffer.from("video-data");
  const ranges: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    ranges.push(request.headers.range);
    if (ranges.length === 1) {
      response.writeHead(200, {
        "content-length": content.length,
        etag: '"media-v1"',
      });
      response.write(content.subarray(0, 5));
      setImmediate(() => response.destroy());
      return;
    }
    response.writeHead(206, {
      "content-length": content.length - 5,
      "content-range": `bytes 5-${content.length - 1}/${content.length}`,
      etag: '"media-v1"',
    });
    response.end(content.subarray(5));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const retryAgent = new RetryAgent(new Agent(), {
    maxRetries: 2,
    minTimeout: 0,
    maxTimeout: 0,
    timeoutFactor: 1,
    throwOnError: false,
  });
  context.after(async () => {
    await retryAgent.close();
    server.close();
    await once(server, "close");
  });

  const response = await undiciFetch(`http://127.0.0.1:${address.port}/media`, {
    dispatcher: retryAgent,
  });

  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), content.toString());
  assert.deepEqual(ranges, [undefined, "bytes=5-9"]);
});

test("Undici拒绝ETag或Content-Range不一致的续传响应", async () => {
  const content = Buffer.from("video-data");
  const scenarios = [
    { etag: '"media-v2"', contentRange: "bytes 5-9/10" },
    { etag: '"media-v1"', contentRange: "bytes 4-9/10" },
  ];

  for (const scenario of scenarios) {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(200, {
          "content-length": content.length,
          etag: '"media-v1"',
        });
        response.write(content.subarray(0, 5));
        setImmediate(() => response.destroy());
        return;
      }
      response.writeHead(206, {
        "content-length": content.length - 5,
        "content-range": scenario.contentRange,
        etag: scenario.etag,
      });
      response.end(content.subarray(5));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const retryAgent = new RetryAgent(new Agent(), {
      maxRetries: 2,
      minTimeout: 0,
      maxTimeout: 0,
      timeoutFactor: 1,
      throwOnError: false,
    });
    try {
      const response = await undiciFetch(`http://127.0.0.1:${address.port}/media`, {
        dispatcher: retryAgent,
      });
      await assert.rejects(() => response.arrayBuffer());
      assert.equal(requests, 2);
    } finally {
      await retryAgent.close();
      server.close();
      await once(server, "close");
    }
  }
});

test("媒体下载通过Undici对5xx有限重试后写入完整文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-test-"));
  const destination = join(directory, "video.mp4");
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const pool = mockAgent.get("https://media.example");
  pool.intercept({ path: "/video.mp4" }).reply(503, "busy");
  pool.intercept({ path: "/video.mp4" }).reply(503, "busy");
  pool.intercept({ path: "/video.mp4" }).reply(200, Buffer.from("video-data"));
  setGlobalDispatcher(mockAgent);
  try {
    await new NodeMediaDownloader({ maxRetries: 2, minRetryDelayMs: 0 }).download(
      { kind: "video", url: "https://media.example/video.mp4" },
      destination,
    );
    assert.equal((await readFile(destination)).toString(), "video-data");
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("媒体下载重试耗尽后保留已有目标文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-cleanup-test-"));
  const destination = join(directory, "video.mp4");
  await writeFile(destination, "partial-data");
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const pool = mockAgent.get("https://media.example");
  pool.intercept({ path: "/broken.mp4" }).reply(503, "busy");
  pool.intercept({ path: "/broken.mp4" }).reply(503, "busy");
  pool.intercept({ path: "/broken.mp4" }).reply(503, "busy");
  setGlobalDispatcher(mockAgent);
  try {
    await assert.rejects(
      () => new NodeMediaDownloader({ maxRetries: 2, minRetryDelayMs: 0 }).download(
        { kind: "video", url: "https://media.example/broken.mp4" },
        destination,
      ),
      (error) => error instanceof TaskError && error.code === "MEDIA_DOWNLOAD_FAILED",
    );
    assert.equal((await readFile(destination)).toString(), "partial-data");
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part") || name.endsWith(".bak")), []);
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("媒体下载成功时替换已有目标且不留下半成品", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-replace-test-"));
  const destination = join(directory, "video.mp4");
  await writeFile(destination, "old-artifact");
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  mockAgent.get("https://media.example")
    .intercept({ path: "/video.mp4" })
    .reply(200, Buffer.from("video-data"));
  setGlobalDispatcher(mockAgent);
  try {
    await new NodeMediaDownloader({ minRetryDelayMs: 0 }).download(
      { kind: "video", url: "https://media.example/video.mp4" },
      destination,
    );
    assert.equal((await readFile(destination)).toString(), "video-data");
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part") || name.endsWith(".bak")), []);
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows覆盖第二步失败时恢复已有目标并只留下临时文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-rollback-test-"));
  const destination = join(directory, "video.mp4");
  const temporary = join(directory, ".video.mp4.part");
  await writeFile(destination, "old-artifact");
  await writeFile(temporary, "new-artifact");
  let calls = 0;
  const moveFile = async (from: string, to: string) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("exists"), { code: "EPERM" });
    if (calls === 3) throw Object.assign(new Error("replace failed"), { code: "EACCES" });
    await rename(from, to);
  };
  try {
    await assert.rejects(
      () => replaceDownloadedFile(temporary, destination, moveFile),
      (error) => error instanceof Error && error.message === "replace failed",
    );
    assert.equal((await readFile(destination)).toString(), "old-artifact");
    assert.equal((await readFile(temporary)).toString(), "new-artifact");
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".bak")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows覆盖回滚失败时保留backup且不吞错", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-rollback-keep-test-"));
  const destination = join(directory, "video.mp4");
  const temporary = join(directory, ".video.mp4.part");
  await writeFile(destination, "old-artifact");
  await writeFile(temporary, "new-artifact");
  let calls = 0;
  const moveFile = async (from: string, to: string) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("exists"), { code: "EPERM" });
    if (calls === 3) throw Object.assign(new Error("replace failed"), { code: "EACCES" });
    if (calls === 4) throw Object.assign(new Error("rollback failed"), { code: "EBUSY" });
    await rename(from, to);
  };
  try {
    await assert.rejects(
      () => replaceDownloadedFile(temporary, destination, moveFile),
      (error) => error instanceof Error && error.message === "rollback failed" && error.cause instanceof Error && error.cause.message === "replace failed",
    );
    await assert.rejects(() => readFile(destination), { code: "ENOENT" });
    const backups = (await readdir(directory)).filter((name) => name.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal((await readFile(join(directory, backups[0]))).toString(), "old-artifact");
    assert.equal((await readFile(temporary)).toString(), "new-artifact");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("视频下载在写入前拒绝明确的HTML、JSON和HLS响应", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-mime-test-"));
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const pool = mockAgent.get("https://media.example");
  const cases = [
    ["html", "text/html; charset=utf-8"],
    ["json", "application/json"],
    ["hls", "application/vnd.apple.mpegurl"],
  ] as const;
  for (const [name, contentType] of cases) {
    pool.intercept({ path: `/${name}.mp4` }).reply(200, "not-video", {
      headers: { "content-type": contentType },
    });
  }
  setGlobalDispatcher(mockAgent);
  try {
    for (const [name] of cases) {
      const destination = join(directory, `${name}.mp4`);
      await assert.rejects(
        () => new NodeMediaDownloader({ maxRetries: 0, minRetryDelayMs: 0 }).download(
          { kind: "video", url: `https://media.example/${name}.mp4` },
          destination,
        ),
        (error) => error instanceof TaskError && error.code === "MEDIA_DOWNLOAD_FAILED",
      );
      await assert.rejects(() => readFile(destination), { code: "ENOENT" });
      assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part")), []);
    }
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("视频下载允许通用二进制响应", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-octet-test-"));
  const destination = join(directory, "video.mp4");
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  mockAgent.get("https://media.example")
    .intercept({ path: "/octet.mp4" })
    .reply(200, Buffer.from("video-data"), {
      headers: { "content-type": "application/octet-stream", "content-length": "10" },
    });
  setGlobalDispatcher(mockAgent);
  try {
    await new NodeMediaDownloader({ minRetryDelayMs: 0 }).download(
      { kind: "video", url: "https://media.example/octet.mp4" },
      destination,
    );
    assert.equal((await readFile(destination)).toString(), "video-data");
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("媒体下载拒绝空响应且不留下目标或半成品", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-length-test-"));
  const originalDispatcher = getGlobalDispatcher();
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const pool = mockAgent.get("https://media.example");
  pool.intercept({ path: "/empty.mp4" }).reply(200, Buffer.alloc(0));
  setGlobalDispatcher(mockAgent);
  try {
    const destination = join(directory, "empty.mp4");
    await assert.rejects(
      () => new NodeMediaDownloader({ maxRetries: 0, minRetryDelayMs: 0 }).download(
        { kind: "video", url: "https://media.example/empty.mp4" },
        destination,
      ),
      (error) => error instanceof TaskError && error.code === "MEDIA_DOWNLOAD_FAILED",
    );
    await assert.rejects(() => readFile(destination), { code: "ENOENT" });
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part")), []);
    mockAgent.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("媒体下载字节数必须与有效Content-Length一致", () => {
  assert.doesNotThrow(() => assertDownloadedLength(10, 10));
  assert.doesNotThrow(() => assertDownloadedLength(10));
  assert.throws(
    () => assertDownloadedLength(5, 10),
    (error) => error instanceof TaskError
      && error.code === "MEDIA_DOWNLOAD_FAILED"
      && error.details?.expectedBytes === 10
      && error.details?.downloadedBytes === 5,
  );
});
