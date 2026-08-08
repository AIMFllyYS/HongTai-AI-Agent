import assert from "node:assert/strict";
import test from "node:test";

import { NativeTaskFiles, parseTaskPath } from "./thin-task-files.js";

function recordingFiles() {
  const writes: Array<{ readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }> = [];
  const appends: Array<{ readonly taskId: string; readonly relativePath: string; readonly value: string }> = [];
  const created: string[] = [];
  return {
    created,
    writes,
    appends,
    plugin: {
      ensure: async ({ taskId }: { readonly taskId: string }) => { created.push(taskId); },
      writeText: async (input: { readonly taskId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }) => { writes.push(input); },
      appendText: async (input: { readonly taskId: string; readonly relativePath: string; readonly value: string }) => { appends.push(input); },
    },
  };
}

test("NativeTaskFiles maps the existing ArtifactStore contract to fixed private task paths", async () => {
  const native = recordingFiles();
  const files = new NativeTaskFiles(native.plugin);

  const paths = await files.initializeTask("task-42");
  await files.writeJson(paths.task, { id: "task-42", status: "running" });
  await files.appendText(paths.log, "{\"sequence\":1}\n");

  assert.equal(paths.root, "task://task-42");
  assert.equal(paths.videoPart, "task://task-42/media/video-source.bin");
  assert.equal(paths.video, "task://task-42/media/video.mp4");
  assert.equal(files.imagePath(paths, 2, { kind: "image", url: "https://images.example/3.jpg" }), "task://task-42/media/images/image-2.bin");
  assert.deepEqual(native.created, ["task-42"]);
  assert.deepEqual(native.writes, [{
    taskId: "task-42",
    relativePath: "task.json",
    value: "{\"id\":\"task-42\",\"status\":\"running\"}",
    replace: true,
  }]);
  assert.deepEqual(native.appends, [{ taskId: "task-42", relativePath: "events.jsonl", value: "{\"sequence\":1}\n" }]);
});

test("NativeTaskFiles rejects paths outside the task it initialized", async () => {
  const native = recordingFiles();
  const files = new NativeTaskFiles(native.plugin);
  const paths = await files.initializeTask("task-42");

  await assert.rejects(() => files.writeText("task://other/task.json", "{}"), /task path/i);
  await assert.rejects(() => files.writeText("https://example.com/task.json", "{}"), /task path/i);
  await assert.doesNotReject(() => files.writeText(paths.metadata, "{}"));
});

test("NativeTaskFiles never makes raw platform diagnostics a required APK artifact", async () => {
  const native = recordingFiles();
  const files = new NativeTaskFiles(native.plugin);
  const paths = await files.initializeTask("task-raw-1");

  await files.writeText(paths.rawPage, "<html>large platform page</html>");
  await files.writeJson(paths.rawResponse, { raw: "large platform response" });

  assert.deepEqual(native.writes, []);
});

test("task paths parse without depending on the host URL implementation", () => {
  const originalUrl = globalThis.URL;
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: class UnsupportedUrl {
      constructor() {
        throw new TypeError("custom schemes are unavailable");
      }
    },
    writable: true,
  });
  try {
    assert.deepEqual(parseTaskPath("task://task-42/media/images/image-2.bin"), {
      taskId: "task-42",
      relativePath: "media/images/image-2.bin",
    });
  } finally {
    Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl, writable: true });
  }
});

test("task paths reject URL syntax and unsafe relative segments", () => {
  for (const value of [
    "task:///task.json",
    "task://task-42/../task.json",
    "task://task-42/media\\image.bin",
    "task://task-42/task.json?replace=true",
    "task://task-42/task.json#fragment",
    "task://task-42/media//image.bin",
    "task://task-42/media/%2e%2e/image.bin",
    "task://task-42/media/line\nfeed.bin",
  ]) {
    assert.throws(() => parseTaskPath(value), /task path/i, value);
  }
});
