import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  commandOutput,
  fileSha256,
  powershellFile,
  root,
  windowsAndroidEnvironment,
  windowsOnly,
} from "./support/android-release-signing.js";

const fetchScript = join(root, "scripts", "fetch-android-heif-sources.ps1");
const canonicalCache = join(root, "android", ".native-deps", "heif-sources");
const libheifRevision = "libheif-2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0";

function runNativeGradleTask(
  sourceCache: string,
  task: string,
  options: string[] = ["--rerun-tasks"],
) {
  const environment = windowsAndroidEnvironment();
  environment.HONGTAI_HEIF_SOURCE_CACHE = sourceCache;
  return spawnSync(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      "gradlew.bat",
      task,
      ...options,
      "--no-daemon",
    ],
    {
      cwd: join(root, "android"),
      encoding: "utf8",
      env: environment,
      timeout: 120_000,
    },
  );
}

test(
  "native source verification rejects unsafe inputs without mutating caches",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-heif-verify-only-"));
    const missingCache = join(fixtureRoot, "missing", "heif-sources");
    try {
      const incompatible = powershellFile(fetchScript, [
        "-VerifyOnly",
        "-ArchiveDirectory",
        canonicalCache,
      ]);
      assert.notEqual(incompatible.status, 0);
      assert.match(commandOutput(incompatible), /VerifyOnly cannot be combined with ArchiveDirectory\./);

      const missing = powershellFile(fetchScript, ["-VerifyOnly", "-SourceCache", missingCache]);
      assert.notEqual(missing.status, 0);
      assert.match(
        commandOutput(missing),
        /Native source verification failed for libheif: source directory is missing\./,
      );
      assert.equal(existsSync(join(fixtureRoot, "missing")), false);

      const relativeEnvironment = windowsAndroidEnvironment();
      relativeEnvironment.HONGTAI_HEIF_SOURCE_CACHE = ".native-deps/heif-sources";
      const relativeOverride = spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", "gradlew.bat", ":app:help", "--no-daemon"],
        {
          cwd: join(root, "android"),
          encoding: "utf8",
          env: relativeEnvironment,
          timeout: 120_000,
        },
      );
      assert.equal(relativeOverride.error, undefined);
      assert.notEqual(relativeOverride.status, 0);
      assert.match(
        commandOutput(relativeOverride),
        /HEIF native source cache override must use an absolute path/,
      );

      const reparseCache = join(fixtureRoot, "reparse-cache");
      const reparseTarget = join(reparseCache, libheifRevision);
      mkdirSync(reparseCache);
      symlinkSync(join(canonicalCache, libheifRevision), reparseTarget, "junction");
      try {
        const reparse = powershellFile(fetchScript, [
          "-VerifyOnly",
          "-SourceCache",
          reparseCache,
        ]);
        assert.notEqual(reparse.status, 0);
        assert.match(
          commandOutput(reparse),
          /Native source verification failed for libheif: source tree contains a reparse point\./,
        );
      } finally {
        rmdirSync(reparseTarget);
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "native clean tasks do not require or mutate a HEIF source cache",
  { skip: windowsOnly },
  () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-heif-native-clean-"));
    const missingCache = join(fixtureRoot, "missing", "heif-sources");
    const canonicalFile = join(canonicalCache, libheifRevision, "CMakeLists.txt");
    const canonicalMarker = join(canonicalCache, libheifRevision, ".hongtai-source-lock.json");
    const canonicalFileHash = fileSha256(canonicalFile);
    const canonicalMarkerHash = fileSha256(canonicalMarker);
    try {
      const nativeClean = runNativeGradleTask(
        missingCache,
        ":app:externalNativeBuildCleanDebug",
      );
      assert.equal(nativeClean.error, undefined);
      assert.equal(nativeClean.status, 0, commandOutput(nativeClean));
      assert.match(commandOutput(nativeClean), /> Task :app:externalNativeBuildCleanDebug/);
      assert.doesNotMatch(commandOutput(nativeClean), /:app:verifyHeifNativeSources/);

      const cleanGraph = runNativeGradleTask(missingCache, "clean", ["--dry-run"]);
      assert.equal(cleanGraph.error, undefined);
      assert.equal(cleanGraph.status, 0, commandOutput(cleanGraph));
      assert.doesNotMatch(commandOutput(cleanGraph), /:app:verifyHeifNativeSources/);

      assert.equal(existsSync(join(fixtureRoot, "missing")), false);
      assert.equal(fileSha256(canonicalFile), canonicalFileHash);
      assert.equal(fileSha256(canonicalMarker), canonicalMarkerHash);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "direct native Gradle configure and build reject a dirty override before CMake",
  { skip: windowsOnly },
  () => {
    assert.equal(existsSync(canonicalCache), true, "fetch the pinned native sources before this gate");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "hongtai-heif-native-gate-"));
    const copiedCache = join(fixtureRoot, "heif-sources");
    const canonicalFile = join(canonicalCache, libheifRevision, "CMakeLists.txt");
    const canonicalMarker = join(canonicalCache, libheifRevision, ".hongtai-source-lock.json");
    const canonicalFileHash = fileSha256(canonicalFile);
    const canonicalMarkerHash = fileSha256(canonicalMarker);
    try {
      cpSync(canonicalCache, copiedCache, { recursive: true, preserveTimestamps: true });
      const copiedFile = join(copiedCache, libheifRevision, "CMakeLists.txt");
      const copiedMarker = join(copiedCache, libheifRevision, ".hongtai-source-lock.json");
      const cleanBytes = readFileSync(copiedFile);
      const cleanMarkerBytes = readFileSync(copiedMarker);
      const marker = JSON.parse(
        cleanMarkerBytes.toString("utf8").replace(/^\uFEFF/, ""),
      ) as { commit: string };
      marker.commit = "0000000000000000000000000000000000000000";
      writeFileSync(copiedMarker, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
      const markerMismatch = powershellFile(fetchScript, [
        "-VerifyOnly",
        "-SourceCache",
        copiedCache,
      ]);
      assert.notEqual(markerMismatch.status, 0);
      assert.match(
        commandOutput(markerMismatch),
        /Native source verification failed for libheif: source marker mismatch\./,
      );
      writeFileSync(copiedMarker, cleanMarkerBytes);
      appendFileSync(copiedFile, "\n# dirty tree review fixture\n", "utf8");

      const dirtyConfigure = runNativeGradleTask(
        copiedCache,
        ":app:configureCMakeDebug[arm64-v8a]",
      );
      assert.equal(dirtyConfigure.error, undefined);
      assert.notEqual(dirtyConfigure.status, 0, commandOutput(dirtyConfigure));
      assert.match(
        commandOutput(dirtyConfigure),
        /Native source verification failed for libheif: source tree hash mismatch\./,
      );
      assert.match(commandOutput(dirtyConfigure), /:app:verifyHeifNativeSources FAILED/);
      assert.doesNotMatch(
        commandOutput(dirtyConfigure),
        /> Task :app:configureCMakeDebug\[arm64-v8a\]/,
      );

      const dirtyBuild = runNativeGradleTask(
        copiedCache,
        ":app:buildCMakeDebug[arm64-v8a]",
      );
      assert.equal(dirtyBuild.error, undefined);
      assert.notEqual(dirtyBuild.status, 0, commandOutput(dirtyBuild));
      assert.match(
        commandOutput(dirtyBuild),
        /Native source verification failed for libheif: source tree hash mismatch\./,
      );
      assert.match(commandOutput(dirtyBuild), /:app:verifyHeifNativeSources FAILED/);
      assert.doesNotMatch(commandOutput(dirtyBuild), /> Task :app:buildCMakeDebug\[arm64-v8a\]/);
      assert.equal(fileSha256(canonicalFile), canonicalFileHash);
      assert.equal(fileSha256(canonicalMarker), canonicalMarkerHash);

      writeFileSync(copiedFile, cleanBytes);
      const cleanBuild = runNativeGradleTask(
        copiedCache,
        ":app:buildCMakeDebug[arm64-v8a]",
      );
      assert.equal(cleanBuild.error, undefined);
      assert.equal(cleanBuild.status, 0, commandOutput(cleanBuild));
      assert.match(commandOutput(cleanBuild), /> Task :app:verifyHeifNativeSources/);
      assert.match(commandOutput(cleanBuild), /> Task :app:configureCMakeDebug\[arm64-v8a\]/);
      assert.match(commandOutput(cleanBuild), /> Task :app:buildCMakeDebug\[arm64-v8a\]/);

      const canonicalVerification = powershellFile(fetchScript, [
        "-VerifyOnly",
        "-SourceCache",
        canonicalCache,
      ]);
      assert.equal(canonicalVerification.status, 0, commandOutput(canonicalVerification));
      assert.equal(fileSha256(canonicalFile), canonicalFileHash);
      assert.equal(fileSha256(canonicalMarker), canonicalMarkerHash);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);
