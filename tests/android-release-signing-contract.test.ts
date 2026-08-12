import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { read, root } from "./support/android-release-signing.js";

test("release builds require an external non-Debug signing identity", () => {
  const gradle = read("android/app/build.gradle.kts");
  const androidIgnore = read("android/.gitignore");
  const rootIgnore = read(".gitignore");

  assert.match(gradle, /HONGTAI_RELEASE_SIGNING_PROPERTIES/);
  assert.match(
    gradle,
    /rawReleaseSigningFile\s*=\s*releaseSigningPath\?\.let\(::File\)/,
  );
  assert.match(
    gradle,
    /rawReleaseSigningFile\s*!=\s*null\s*&&\s*!rawReleaseSigningFile\.isAbsolute/,
  );
  assert.match(
    gradle,
    /rawKeyStore\s*=\s*File\(requiredReleaseSigningValue\("storeFile"\)\)/,
  );
  assert.match(gradle, /if\s*\(!rawKeyStore\.isAbsolute\)/);
  assert.match(
    gradle,
    /releaseSigningFile\.reader\(Charsets\.UTF_8\)\.use\(releaseSigning::load\)/,
  );
  assert.doesNotMatch(
    gradle,
    /releaseSigningFile\.inputStream\(\)\.use\(releaseSigning::load\)/,
  );
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
  for (const taskName of [
    "assembleRelease",
    "bundleRelease",
    "packageRelease",
    "packageReleaseBundle",
    "packageReleaseUniversalApk",
    "signReleaseBundle",
    "installRelease",
    "validateSigningRelease",
  ]) {
    assert.match(gradle, new RegExp(`"${taskName}"`));
  }
  assert.match(gradle, /task\.name\s+in\s+releaseArtifactTaskNames/);
  assert.doesNotMatch(gradle, /task\.name\.contains\("Release"/);
  assert.doesNotMatch(gradle, /task\.name\.startsWith\(operation/);
  assert.doesNotMatch(gradle, /gradle\.startParameter\.taskNames/);
  assert.match(
    gradle,
    /GradleException\("Release signing configuration is required/,
  );
  assert.match(gradle, /canonicalFile/);
  assert.match(gradle, /isInsideRepository/);
  assert.match(gradle, /Files\.isSymbolicLink/);
  assert.match(gradle, /toRealPath/);
  assert.match(gradle, /pathTraversesReparsePoint\(releaseSigningFile\)/);
  assert.match(gradle, /pathTraversesReparsePoint\(keyStore\)/);
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
    "scripts/android-release-signing-transaction.psm1",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`);
  }

  const init = read("scripts/init-android-release-signing.ps1");
  const build = read("scripts/build-android-release.ps1");
  const transaction = read("scripts/android-release-signing-transaction.psm1");
  assert.match(init, /RandomNumberGenerator/);
  assert.match(init, /-storepass:env/);
  assert.match(init, /-keypass:env/);
  assert.match(init, /already exist/);
  assert.match(init, /Resolve-CanonicalPath/);
  assert.match(init, /Test-PathInsideRepository/);
  assert.match(init, /Assert-NoReparsePoint/);
  assert.match(init, /FileAttributes.*ReparsePoint/);
  assert.match(init, /Assert-NoReparsePoint\s+-Path\s+\$SigningDirectory/);
  assert.match(build, /Resolve-CanonicalPath/);
  assert.match(build, /Test-PathInsideRepository/);
  assert.match(build, /Assert-NoReparsePoint/);
  assert.match(build, /FileAttributes.*ReparsePoint/);
  assert.match(build, /Assert-NoReparsePoint\s+-Path\s+\$SigningProperties/);
  for (const script of [init, build]) {
    assert.match(
      script,
      /\$rawRepositoryRoot\s*=\s*Join-Path\s+\$PSScriptRoot\s+"\.\."[\s\S]*Assert-NoReparsePoint\s+-Path\s+\$rawRepositoryRoot[\s\S]*\$repositoryRoot\s*=\s*Resolve-CanonicalPath\s+-Path\s+\$rawRepositoryRoot/,
    );
  }
  assert.match(
    init,
    /if\s*\(Test-Path\s+-LiteralPath\s+\$resolvedSigningDirectory\)[\s\S]*must not already exist/,
  );
  assert.match(init, /android-release-signing-transaction\.psm1/);
  assert.match(init, /Publish-AndroidReleaseSigningDirectory/);
  assert.match(init, /Remove-AndroidReleaseSigningStagingDirectory/);
  assert.match(init, /-ExpectedParentDirectory\s+\$signingParentDirectory/g);
  assert.doesNotMatch(init, /Move-Item/);
  assert.match(transaction, /\[System\.IO\.Directory\]::Move/);
  assert.match(transaction, /ExpectedParentDirectory/);
  assert.match(transaction, /\^\\\.signing\\\.\[0-9a-f\]\{32\}\\\.staging\$/);
  assert.match(transaction, /OrdinalIgnoreCase/);
  assert.match(transaction, /Assert-NoReparsePoint/);
  assert.match(transaction, /FileAttributes[\s\S]*ReparsePoint/);
  assert.doesNotMatch(transaction, /Remove-Item\s+[^\r\n]*-Recurse/);
  assert.doesNotMatch(build, /VerifyExistingApk/);
  assert.match(
    init,
    /try\s*\{[\s\S]*\$storePassword\s*=\s*New-RandomSecret\s*\$keyPassword\s*=\s*New-RandomSecret/,
  );
  assert.match(
    init,
    /finally\s*\{[\s\S]*\$properties\s*=\s*\$null[\s\S]*\$storePassword\s*=\s*\$null[\s\S]*\$keyPassword\s*=\s*\$null/,
  );
  assert.doesNotMatch(init + build, /debug\.keystore/);
  for (const tool of ["zipalign", "aapt2", "apksigner"]) {
    assert.match(build, new RegExp(tool));
  }
  assert.match(build, /Verified using v2 scheme[\s\S]*true/);
  assert.match(build, /Verified using v3 scheme[\s\S]*true/);
  assert.match(build, /Android Debug/);
  assert.match(build, /release-certificate\.sha256/);
  assert.match(build, /Get-FileHash[\s\S]*SHA256/);
});

test("release build normalizes generated Capacitor XML immediately after sync", () => {
  const normalizerPath = "scripts/normalize-capacitor-config.ps1";
  assert.equal(existsSync(join(root, normalizerPath)), true);
  const build = read("scripts/build-android-release.ps1");
  assert.match(
    build,
    /"exec",\s*"cap",\s*"sync",\s*"android"[\s\S]*normalize-capacitor-config\.ps1/,
  );
});
