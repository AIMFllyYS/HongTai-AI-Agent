import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import {
  Agent,
  fetch as undiciFetch,
  getGlobalDispatcher,
  MockAgent,
  RetryAgent,
  setGlobalDispatcher,
} from "undici";
import { TaskError } from "../packages/core/src/index";
import {
  assertDownloadedLength,
  FfmpegMediaTools,
  MAX_PAGE_RESPONSE_BYTES,
  NodeHttpClient,
  NodeMediaDownloader,
  replaceDownloadedFile,
  type FfmpegSpawn,
  type MediaDownloadFetch,
} from "../packages/node-runtime/src/index";

function hangingChildProcess(killed: NodeJS.Signals[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: NodeJS.Signals) => boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal?: NodeJS.Signals) => {
    killed.push(signal ?? "SIGTERM");
    return true;
  };
  return child as unknown as ChildProcess;
}

function cancellableDownloadBody(onCancel: () => void) {
  return {
    cancel: async () => {
      onCancel();
    },
    getReader() {
      throw new Error("响应流应在读取前被取消");
    },
  };
}

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

test("HTTP客户端拒绝超过页面响应上限的声明长度", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("too-large", {
    status: 200,
    headers: { "content-length": String(MAX_PAGE_RESPONSE_BYTES + 1) },
  });
  try {
    await assert.rejects(
      () => new NodeHttpClient({ retryDelaysMs: [0] }).get({ url: "https://example.com/large" }),
      (error) => error instanceof TaskError && error.code === "LINK_HTTP_ERROR" && /安全大小限制/u.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP客户端拒绝本机和私网 HTTPS 目标", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("unexpected");
  };
  try {
    for (const url of ["https://127.0.0.1/private", "https://[::1]/private", "https://192.168.1.5/private"]) {
      await assert.rejects(
        () => new NodeHttpClient({ retryDelaysMs: [0] }).get({ url }),
        (error) => error instanceof TaskError && error.code === "INPUT_URL_INVALID" && /公开网络地址/u.test(error.message),
      );
    }
    assert.equal(called, false);
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

test("HTTP客户端maxRedirects为0时只解析Location不读目标正文", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = async (input) => {
    fetched.push(String(input));
    if (String(input).includes("/start")) {
      return new Response("<html>short-link</html>", {
        status: 302,
        headers: { location: "https://www.bilibili.com/video/BV1xx411c7mD" },
      });
    }
    return new Response("<html>final desktop page</html>", { status: 200 });
  };
  try {
    const response = await new NodeHttpClient({ retryDelaysMs: [0] }).get({
      url: "https://b23.tv/start",
      maxRedirects: 0,
    });
    assert.equal(response.url, "https://www.bilibili.com/video/BV1xx411c7mD");
    assert.equal(response.status, 302);
    assert.equal(response.body, "");
    assert.deepEqual(fetched, ["https://b23.tv/start"]);
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

test("FFmpeg超时后先SIGTERM再强杀子进程", async () => {
  const killed: NodeJS.Signals[] = [];
  const spawn: FfmpegSpawn = () => hangingChildProcess(killed);
  const tools = new FfmpegMediaTools({ timeoutMs: 30, killGraceMs: 20, spawn });
  await assert.rejects(
    () => tools.probeDuration("video.mp4"),
    (error) => error instanceof TaskError && error.code === "MEDIA_PROBE_FAILED",
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(killed, ["SIGTERM", "SIGKILL"]);
});

test("FFmpeg失败只删除临时文件并保留已有产物", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ffmpeg-keep-test-"));
  const outputPath = join(directory, "merged.mp4");
  await writeFile(outputPath, "existing-artifact");
  const spawn: FfmpegSpawn = (_command, args) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    const temporary = args[args.length - 1];
    if (typeof temporary === "string") writeFileSync(temporary, "partial-output");
    queueMicrotask(() => child.emit("close", 1));
    return child as unknown as ChildProcess;
  };
  try {
    await assert.rejects(
      () => new FfmpegMediaTools({ spawn }).merge("video.mp4", "audio.m4a", outputPath),
      (error) => error instanceof TaskError && error.code === "MEDIA_MERGE_FAILED",
    );
    assert.equal((await readFile(outputPath)).toString(), "existing-artifact");
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part") || name.endsWith(".bak")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("媒体下载在HTTP失败、创建目录失败和打开文件失败时取消响应流", async () => {
  const destination = join(tmpdir(), "hongtai-download-cancel", "video.mp4");
  let cancelled = 0;
  const cases: Array<{
    name: string;
    options: ConstructorParameters<typeof NodeMediaDownloader>[0];
    code: TaskError["code"];
  }> = [
    {
      name: "!ok",
      options: {
        fetch: (async () => ({
          url: "https://media.example/missing.mp4",
          status: 404,
          ok: false,
          headers: { get: () => null },
          body: cancellableDownloadBody(() => { cancelled += 1; }),
        })) as MediaDownloadFetch,
      },
      code: "MEDIA_SOURCE_NOT_FOUND",
    },
    {
      name: "mkdir",
      options: {
        fetch: (async () => ({
          url: "https://media.example/video.mp4",
          status: 200,
          ok: true,
          headers: { get: () => null },
          body: cancellableDownloadBody(() => { cancelled += 1; }),
        })) as MediaDownloadFetch,
        mkdir: async () => {
          throw Object.assign(new Error("enospc"), { code: "ENOSPC" });
        },
      },
      code: "STORAGE_SPACE_INSUFFICIENT",
    },
    {
      name: "open",
      options: {
        fetch: (async () => ({
          url: "https://media.example/video.mp4",
          status: 200,
          ok: true,
          headers: { get: () => null },
          body: cancellableDownloadBody(() => { cancelled += 1; }),
        })) as MediaDownloadFetch,
        mkdir: async () => undefined,
        openFile: async () => {
          throw Object.assign(new Error("eacces"), { code: "EACCES" });
        },
      },
      code: "STORAGE_PERMISSION_DENIED",
    },
  ];

  for (const item of cases) {
    cancelled = 0;
    await assert.rejects(
      () => new NodeMediaDownloader({ maxRetries: 0, minRetryDelayMs: 0, ...item.options }).download(
        { kind: "video", url: "https://media.example/video.mp4" },
        destination,
      ),
      (error) => error instanceof TaskError && error.code === item.code,
      item.name,
    );
    assert.equal(cancelled, 1, item.name);
  }
});

test("媒体下载在无Content-Length时也拒绝超过本地上限的流", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-limit-"));
  let cancelled = 0;
  try {
    await assert.rejects(
      () => new NodeMediaDownloader({
        maxRetries: 0,
        minRetryDelayMs: 0,
        maxBytes: 4,
        fetch: (async () => ({
          url: "https://media.example/video.mp4",
          status: 200,
          ok: true,
          headers: { get: () => null },
          body: lockingDownloadBody(() => { cancelled += 1; }, async () => ({ done: false, value: new Uint8Array([1, 2, 3, 4, 5]) })),
        })) as MediaDownloadFetch,
      }).download(
        { kind: "video", url: "https://media.example/video.mp4" },
        join(directory, "video.mp4"),
      ),
      (error) => error instanceof TaskError && error.code === "STORAGE_SPACE_INSUFFICIENT",
    );
    assert.equal(cancelled, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function lockingDownloadBody(
  onCancel: () => void,
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>,
) {
  let locked = false;
  return {
    cancel: async () => {
      if (locked) throw new TypeError("ReadableStream is locked");
      onCancel();
    },
    getReader() {
      if (locked) throw new TypeError("ReadableStream is locked");
      locked = true;
      return {
        read,
        cancel: async () => {
          onCancel();
        },
      };
    },
  };
}

test("媒体下载在读流开始后失败时仍取消响应流", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-download-read-cancel-"));
  let cancelled = 0;
  const cases: Array<{
    name: string;
    options: ConstructorParameters<typeof NodeMediaDownloader>[0];
    code: TaskError["code"];
  }> = [
    {
      name: "write",
      options: {
        mkdir: async () => undefined,
        openFile: (async () => ({
          write: async () => {
            throw Object.assign(new Error("enospc"), { code: "ENOSPC" });
          },
          close: async () => undefined,
        })) as typeof import("node:fs/promises").open,
        fetch: (async () => ({
          url: "https://media.example/video.mp4",
          status: 200,
          ok: true,
          headers: { get: () => null },
          body: lockingDownloadBody(() => { cancelled += 1; }, async () => ({ done: false, value: new Uint8Array([1, 2, 3]) })),
        })) as MediaDownloadFetch,
      },
      code: "STORAGE_SPACE_INSUFFICIENT",
    },
    {
      name: "read",
      options: {
        fetch: (async () => {
          let reads = 0;
          return {
            url: "https://media.example/video.mp4",
            status: 200,
            ok: true,
            headers: { get: () => null },
            body: lockingDownloadBody(() => { cancelled += 1; }, async () => {
              reads += 1;
              if (reads === 1) return { done: false, value: new Uint8Array([1, 2, 3]) };
              throw new Error("socket hang up");
            }),
          };
        }) as MediaDownloadFetch,
      },
      code: "MEDIA_DOWNLOAD_FAILED",
    },
  ];

  try {
    for (const item of cases) {
      cancelled = 0;
      await assert.rejects(
        () => new NodeMediaDownloader({ maxRetries: 0, minRetryDelayMs: 0, ...item.options }).download(
          { kind: "video", url: "https://media.example/video.mp4" },
          join(directory, `${item.name}.mp4`),
        ),
        (error) => error instanceof TaskError && error.code === item.code,
        item.name,
      );
      assert.equal(cancelled, 1, item.name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function splitAudioSpawn(writeSegments: (directory: string) => void): FfmpegSpawn {
  return (_command, args) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    const pattern = args[args.length - 1];
    if (typeof pattern === "string") writeSegments(dirname(pattern));
    queueMicrotask(() => child.emit("close", 0));
    return child as unknown as ChildProcess;
  };
}

test("音频切片全部成功后才替换已有分段", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ffmpeg-split-success-"));
  await writeFile(join(directory, "segment-0000.wav"), "old-0");
  await writeFile(join(directory, "segment-0001.wav"), "old-1");
  const spawn = splitAudioSpawn((temporaryDirectory) => {
    writeFileSync(join(temporaryDirectory, "segment-0000.wav"), "new-0");
    writeFileSync(join(temporaryDirectory, "segment-0001.wav"), "new-1");
  });
  try {
    const files = await new FfmpegMediaTools({ spawn }).splitAudio("audio.wav", directory, 30);
    assert.deepEqual(files, [join(directory, "segment-0000.wav"), join(directory, "segment-0001.wav")]);
    assert.equal((await readFile(join(directory, "segment-0000.wav"))).toString(), "new-0");
    assert.equal((await readFile(join(directory, "segment-0001.wav"))).toString(), "new-1");
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("音频切片替换中途失败时保留已有分段", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ffmpeg-split-keep-"));
  await writeFile(join(directory, "segment-0000.wav"), "old-0");
  await writeFile(join(directory, "segment-0001.wav"), "old-1");
  const spawn = splitAudioSpawn((temporaryDirectory) => {
    writeFileSync(join(temporaryDirectory, "segment-0000.wav"), "new-0");
    writeFileSync(join(temporaryDirectory, "segment-0001.wav"), "new-1");
  });
  let replaces = 0;
  try {
    await assert.rejects(
      () => new FfmpegMediaTools({
        spawn,
        replaceFile: async (temporary, destination) => {
          replaces += 1;
          if (replaces === 2) throw Object.assign(new Error("replace failed"), { code: "EACCES" });
          await replaceDownloadedFile(temporary, destination);
        },
      }).splitAudio("audio.wav", directory, 30),
      (error) => error instanceof TaskError && error.code === "MEDIA_PROBE_FAILED",
    );
    assert.equal((await readFile(join(directory, "segment-0000.wav"))).toString(), "old-0");
    assert.equal((await readFile(join(directory, "segment-0001.wav"))).toString(), "old-1");
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("音频切片恢复失败时保留backup且不吞错", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ffmpeg-split-restore-keep-"));
  await writeFile(join(directory, "segment-0000.wav"), "old-0");
  await writeFile(join(directory, "segment-0001.wav"), "old-1");
  const spawn = splitAudioSpawn((temporaryDirectory) => {
    writeFileSync(join(temporaryDirectory, "segment-0000.wav"), "new-0");
    writeFileSync(join(temporaryDirectory, "segment-0001.wav"), "new-1");
  });
  let replaces = 0;
  try {
    await assert.rejects(
      () => new FfmpegMediaTools({
        spawn,
        replaceFile: async (temporary, destination) => {
          replaces += 1;
          if (replaces === 2) throw Object.assign(new Error("replace failed"), { code: "EACCES" });
          await replaceDownloadedFile(temporary, destination);
        },
        copyFile: async (source, destination) => {
          if (source.includes(".segments-backup-")) {
            throw Object.assign(new Error("restore failed"), { code: "EBUSY" });
          }
          await copyFile(source, destination);
        },
      }).splitAudio("audio.wav", directory, 30),
      (error) => error instanceof TaskError
        && error.code === "MEDIA_PROBE_FAILED"
        && error.cause instanceof Error
        && error.cause.message === "restore failed"
        && error.cause.cause instanceof Error
        && error.cause.cause.message === "replace failed",
    );
    const backups = (await readdir(directory)).filter((name) => name.startsWith(".segments-backup-"));
    assert.equal(backups.length, 1);
    assert.equal((await readFile(join(directory, backups[0], "segment-0000.wav"))).toString(), "old-0");
    assert.equal((await readFile(join(directory, backups[0], "segment-0001.wav"))).toString(), "old-1");
    assert.equal((await readFile(join(directory, "segment-0000.wav"))).toString(), "new-0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("音频切片备份失败时保留已有分段", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hongtai-ffmpeg-split-backup-keep-"));
  await writeFile(join(directory, "segment-0000.wav"), "old-0");
  await writeFile(join(directory, "segment-0001.wav"), "old-1");
  const spawn = splitAudioSpawn((temporaryDirectory) => {
    writeFileSync(join(temporaryDirectory, "segment-0000.wav"), "new-0");
    writeFileSync(join(temporaryDirectory, "segment-0001.wav"), "new-1");
  });
  try {
    await assert.rejects(
      () => new FfmpegMediaTools({
        spawn,
        copyFile: async () => {
          throw Object.assign(new Error("backup failed"), { code: "ENOSPC" });
        },
      }).splitAudio("audio.wav", directory, 30),
      (error) => error instanceof TaskError && error.code === "MEDIA_PROBE_FAILED",
    );
    assert.equal((await readFile(join(directory, "segment-0000.wav"))).toString(), "old-0");
    assert.equal((await readFile(join(directory, "segment-0001.wav"))).toString(), "old-1");
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
