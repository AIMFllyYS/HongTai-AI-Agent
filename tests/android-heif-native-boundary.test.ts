import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("legacy HEIF sources are pinned, decoder-only, dynamic, and reproducible", () => {
  const lockPath = join(root, "android/native-deps/heif-lock.json");
  assert.ok(existsSync(lockPath), "missing native dependency lock");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.deepEqual(lock.android.abis, ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
  assert.equal(lock.android.minApi, 24);
  assert.equal(lock.android.ndkVersion, "28.2.13676358");
  assert.equal(lock.android.linkage, "dynamic-lgpl");
  assert.equal(lock.android.maxPageSize, 16384);

  const expected = {
    libheif: ["v1.23.1", "2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0"],
    libde265: ["v1.1.1", "4dd701fffac01632ffd5cabc5ef10deb56accba1"],
  } as const;
  for (const [name, [tag, commit]] of Object.entries(expected)) {
    const dependency = lock.dependencies[name];
    assert.equal(dependency.tag, tag);
    assert.equal(dependency.commit, commit);
    assert.match(dependency.url, /^https:\/\/github\.com\/strukturag\//);
    assert.match(dependency.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(dependency.sourceTreeSha256, /^[a-f0-9]{64}$/);
    assert.equal(dependency.license, "LGPL-3.0-or-later");
  }

  assert.deepEqual(lock.features.encoders, []);
  assert.deepEqual(lock.features.decoders, ["libde265-hevc"]);
  assert.equal(lock.features.avif, false);
  assert.equal(lock.features.lto, false);
});

test("native build and LGPL delivery boundaries are checked in without binaries", () => {
  const required = [
    "scripts/fetch-android-heif-sources.ps1",
    "android/app/src/main/cpp/heif/CMakeLists.txt",
    "android/app/src/main/cpp/heif/legacy_heif_jni.cpp",
    "android/third_party/heif/LICENSES/libheif-LGPL-3.0.txt",
    "android/third_party/heif/LICENSES/libde265-LGPL-3.0.txt",
    "android/third_party/heif/NOTICE.md",
    "android/third_party/heif/sbom.spdx.json",
  ];
  required.forEach((path) => assert.ok(existsSync(join(root, path)), `missing ${path}`));

  const gradle = read("android/app/build.gradle.kts");
  const fetch = read("scripts/fetch-android-heif-sources.ps1");
  const cmake = read("android/app/src/main/cpp/heif/CMakeLists.txt");
  const notice = read("android/third_party/heif/NOTICE.md");
  const ignore = read(".gitignore");
  assert.match(gradle, /ndkVersion\s*=\s*"28\.2\.13676358"/);
  assert.match(gradle, /abiFilters\.addAll\(listOf\("arm64-v8a", "armeabi-v7a", "x86", "x86_64"\)\)/);
  assert.match(gradle, /HONGTAI_HEIF_SOURCE_CACHE/);
  assert.match(gradle, /verifyHeifNativeSources/);
  assert.match(gradle, /dependsOn\(verifyHeifNativeSources\)/);
  assert.match(fetch, /\[switch\]\$VerifyOnly/);
  assert.match(fetch, /FileAttributes\]::ReparsePoint/);
  assert.match(cmake, /BUILD_SHARED_LIBS\s+ON/);
  assert.match(cmake, /WITH_LIBDE265\s+ON/);
  assert.match(cmake, /ENABLE_PLUGIN_LOADING\s+OFF/);
  assert.match(cmake, /max-page-size=16384/);
  assert.match(cmake, /WITH_X265\s+OFF/);
  assert.match(cmake, /WITH_AOM_DECODER\s+OFF/);
  assert.match(cmake, /WITH_DAV1D\s+OFF/);
  assert.match(cmake, /WITH_LIBDE265_PLUGIN\s+OFF/);
  assert.match(notice, /dynamic/i);
  assert.match(notice, /corresponding source/i);
  assert.match(notice, /reverse engineering/i);
  assert.match(ignore, /android\/\.native-deps\/heif-sources\//);

  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(tracked, /(?:^|\/)(?:heif-sources|\.native-deps)(?:\/|$)/m);
  assert.doesNotMatch(tracked, /\.(?:aar|so|apk|zip|tar|tgz|gz)$/im);
  for (const path of required) {
    assert.doesNotMatch(path, /\.(?:aar|so|apk|zip|tar|gz)$/i);
  }

  const native = read("android/app/src/main/cpp/heif/legacy_heif_jni.cpp");
  const mediaStore = read("android/app/src/main/java/com/hongtai/aiagent/media/PrivateMediaStore.kt");
  const instrumentation = read(
    "android/app/src/androidTest/java/com/hongtai/aiagent/media/PrivateMediaStoreInstrumentationTest.kt",
  );
  assert.match(native, /heif_context_has_sequence/);
  assert.match(native, /data_reference_index\s*!=\s*0/);
  assert.match(native, /max_image_size_pixels/);
  assert.match(native, /max_total_memory/);
  assert.match(native, /strict_decoding\s*=\s*1/);
  assert.match(native, /std::unique_ptr/);
  assert.doesNotMatch(native, /ByteArray|GetByteArrayElements|NewGlobalRef|abort\s*\(/);
  assert.doesNotMatch(mediaStore, /fun\s+(?:readHeader|imageMimeType)\s*\(/);
  assert.doesNotMatch(instrumentation, /PrivateMediaImportPolicy::readHeader/);
});

test("HEIF instrumentation reads fixtures from the test APK asset context", () => {
  const harness = read(
    "android/app/src/androidTest/java/com/hongtai/aiagent/media/PrivateMediaStoreInstrumentationTest.kt",
  );
  assert.match(harness, /InstrumentationRegistry\.getInstrumentation\(\)\.context\.assets/);
  assert.doesNotMatch(harness, /^\s*context\.assets\.open\("heif\/\$assetName"\)/m);
});
