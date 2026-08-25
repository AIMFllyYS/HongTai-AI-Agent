import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const archiveScript = join(root, "scripts", "archive-android-release.ps1");

function invokeArchive(sourceApk: string, versionName: string, archiveRoot: string): string {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      archiveScript,
      "-SourceApk",
      sourceApk,
      "-VersionName",
      versionName,
      "-ArchiveRoot",
      archiveRoot,
    ],
    { encoding: "utf8" },
  );
}

test("Release is the only APK product and uses the canonical versioned archive name", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const releaseBuilder = readFileSync(join(root, "scripts", "build-android-release.ps1"), "utf8");

  assert.equal(existsSync(join(root, "scripts", "build-android-debug.ps1")), false);
  assert.match(readme, /唯一 APK 构建与交付入口/u);
  assert.match(releaseBuilder, /archive-android-release[.]ps1/u);
  assert.match(releaseBuilder, /output[\\/]apk-archive/u);
  assert.doesNotMatch(releaseBuilder, /assembleDebug/u);
  const archiveScriptSource = readFileSync(archiveScript, "utf8");
  assert.match(archiveScriptSource, /Assert-NoReparsePoint/);
  assert.match(archiveScriptSource, /Release APK archive must not traverse a reparse point/);
});

test("archiving is idempotent for identical bytes and rejects a conflicting overwrite", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "hongtai-release-archive-"));
  const sourceApk = join(temporaryRoot, "app-release.apk");
  const archiveRoot = join(temporaryRoot, "archive");
  const expectedApk = join(archiveRoot, "HongTai-AI-Agent-release-v0.1.12.apk");

  try {
    writeFileSync(sourceApk, "first-release-bytes", "utf8");
    invokeArchive(sourceApk, "0.1.12", archiveRoot);
    assert.equal(readFileSync(expectedApk, "utf8"), "first-release-bytes");

    invokeArchive(sourceApk, "0.1.12", archiveRoot);
    assert.equal(readFileSync(expectedApk, "utf8"), "first-release-bytes");

    writeFileSync(sourceApk, "different-release-bytes", "utf8");
    assert.throws(
      () => invokeArchive(sourceApk, "0.1.12", archiveRoot),
      /Refusing to overwrite archived APK with different bytes/u,
    );
    assert.equal(readFileSync(expectedApk, "utf8"), "first-release-bytes");
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
