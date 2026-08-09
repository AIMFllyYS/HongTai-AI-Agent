import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("release builds require an external non-Debug signing identity", () => {
  const gradle = read("android/app/build.gradle.kts");
  const androidIgnore = read("android/.gitignore");
  const rootIgnore = read(".gitignore");

  assert.match(gradle, /HONGTAI_RELEASE_SIGNING_PROPERTIES/);
  assert.match(gradle, /signingConfigs\s*\{[\s\S]*create\("release"\)/);
  assert.match(
    gradle,
    /release\s*\{[\s\S]*signingConfig\s*=\s*signingConfigs\.findByName\("release"\)/,
  );
  assert.match(
    gradle,
    /gradle\.taskGraph\.whenReady\s*\(\s*object\s*:\s*Action<TaskExecutionGraph>/,
  );
  assert.match(gradle, /graph\.allTasks\.any/);
  assert.match(gradle, /task\.name\.contains\("Release",\s*ignoreCase\s*=\s*true\)/);
  assert.doesNotMatch(gradle, /gradle\.startParameter\.taskNames/);
  assert.match(
    gradle,
    /GradleException\("Release signing configuration is required/,
  );
  assert.match(gradle, /canonicalFile/);
  assert.match(gradle, /isInsideRepository/);
  assert.match(gradle, /enableV1Signing\s*=\s*false/);
  assert.match(gradle, /enableV2Signing\s*=\s*true/);
  assert.match(gradle, /enableV3Signing\s*=\s*true/);
  assert.match(gradle, /alias\.equals\("androiddebugkey",\s*ignoreCase\s*=\s*true\)/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|debug\.keystore/i);
  assert.match(androidIgnore, /^\/keystore\.properties$/m);
  assert.match(androidIgnore, /^\/\*\.jks$/m);
  assert.match(androidIgnore, /^\/\*\.keystore$/m);
  assert.match(androidIgnore, /^\/\*\.p12$/m);
  assert.match(rootIgnore, /^\*\.jks$/m);
  assert.match(rootIgnore, /^\*\.keystore$/m);
  assert.match(rootIgnore, /^\*\.p12$/m);
  assert.match(rootIgnore, /^keystore\.properties$/m);
});

test("release tooling verifies the anchored certificate and signed APK", () => {
  for (const path of [
    "android/keystore.properties.example",
    "android/release-certificate.sha256",
    "scripts/init-android-release-signing.ps1",
    "scripts/build-android-release.ps1",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`);
  }

  const init = read("scripts/init-android-release-signing.ps1");
  const build = read("scripts/build-android-release.ps1");
  assert.match(init, /RandomNumberGenerator/);
  assert.match(init, /-storepass:env/);
  assert.match(init, /-keypass:env/);
  assert.match(init, /already exists/);
  assert.match(init, /Resolve-CanonicalPath/);
  assert.match(init, /Test-PathInsideRepository/);
  assert.match(build, /Resolve-CanonicalPath/);
  assert.match(build, /Test-PathInsideRepository/);
  assert.doesNotMatch(build, /VerifyExistingApk/);
  assert.match(
    init,
    /try\s*\{\s*\$storePassword\s*=\s*New-RandomSecret\s*\$keyPassword\s*=\s*New-RandomSecret/,
  );
  assert.match(
    init,
    /finally\s*\{[\s\S]*\$properties\s*=\s*\$null[\s\S]*\$storePassword\s*=\s*\$null[\s\S]*\$keyPassword\s*=\s*\$null/,
  );
  assert.doesNotMatch(init + build, /debug\.keystore/);
  assert.match(build, /zipalign/);
  assert.match(build, /aapt2/);
  assert.match(build, /apksigner/);
  assert.match(build, /Verified using v2 scheme[\s\S]*true/);
  assert.match(build, /Verified using v3 scheme[\s\S]*true/);
  assert.match(build, /Android Debug/);
  assert.match(build, /release-certificate\.sha256/);
  assert.match(build, /Get-FileHash[\s\S]*SHA256/);
});
