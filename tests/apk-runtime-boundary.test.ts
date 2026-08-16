import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("APK entry loads only the standalone runtime and never a Node or .env dependency", () => {
  const entry = read("apps/web/src/main.tsx");
  const runtime = read("packages/capacitor-runtime/src/standalone-app-runtime.ts");

  assert.match(entry, /createStandaloneAppRuntime/);
  assert.match(entry, /registerStandaloneNativePlugins/);
  for (const source of [entry, runtime]) {
    assert.doesNotMatch(source, /node:|\.env|@hongtai\/node-runtime|FileArtifactStore|FfmpegMediaTools|TerminalProgressReporter/);
  }
});

test("组合层引用共享文稿改写导出，不再内联 Prompt 字面量", () => {
  const runtime = read("packages/capacitor-runtime/src/standalone-app-runtime.ts");
  assert.match(runtime, /TRANSCRIPT_REWRITE_SYSTEM_PROMPT/);
  assert.match(runtime, /splitTranscriptRewriteChunks/);
  assert.doesNotMatch(runtime, /将以下文稿整理为清晰、忠实的中文稿/);
  assert.doesNotMatch(runtime, /你是短视频文稿整理助手/);
  assert.doesNotMatch(runtime, /只根据原始语音转写整理/);
  assert.doesNotMatch(runtime, /只返回整理后的正文/);
});
