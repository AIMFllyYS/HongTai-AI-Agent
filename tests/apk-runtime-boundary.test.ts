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
