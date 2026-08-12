# Issue #5 Release Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a fail-closed, non-Debug Android release signing identity and prove a signed `com.hongtai.aiagent` APK can follow a same-certificate normal-upgrade path without committing secrets.

**Architecture:** Keep private keystore material outside Git and expose it to the Android build through one external properties-file contract. Gradle owns variant signing; PowerShell tooling owns safe first-key initialization and deterministic host verification; repository tests guard the boundary, while dated acceptance evidence records only public metadata and actual Android results.

**Tech Stack:** Android Gradle Plugin 8.13/Kotlin DSL, Gradle 8.14.3, PowerShell 7/Windows PowerShell-compatible scripts, JDK 21 `keytool`, Android SDK `apksigner`/`aapt2`/`zipalign`, Node test runner, ADB/API 35 emulator.

---

## Task contract

### Goal

- User-visible result: a non-Debug release candidate is reproducibly signed and can be installed/upgraded as the same Android application identity.

### Allowed changes

- `android/app/build.gradle.kts`
- `android/.gitignore`
- `android/keystore.properties.example`
- `android/release-certificate.sha256`
- `scripts/init-android-release-signing.ps1`
- `scripts/build-android-release.ps1`
- `tests/android-release-signing.test.ts`
- `README.md`
- `docs/文档索引.md`
- `docs/当前能力与发布状态.md`
- `docs/Android发布签名与升级指南.md`
- `docs/验收/2026-08-10-android-release-signing.md`

### Explicit non-goals

- No Play Console, CI secret store, cloud signer, new publication channel, runtime Android Keystore change, UI change, or business-flow change.
- Do not overwrite an existing release keystore, rewrite historical QA evidence, or claim physical-device validation without a connected physical device.
- Do not put keystore bytes, passwords, private paths, command lines containing passwords, or secret values in Git, logs, tests, docs, or acceptance evidence.

### Architecture owner and source of truth

- Owner: Android build/release layer only.
- Release identity source: public certificate SHA-256 in `android/release-certificate.sha256`; private source is the external keystore selected by `HONGTAI_RELEASE_SIGNING_PROPERTIES`.
- Upgrade identity source: APK manifest version, `apksigner` certificate digest, PackageManager state, and the controlled private sample hash.

## Task 1: Add the failing release-signing boundary test

**Files:**
- Create: `tests/android-release-signing.test.ts`
- Read: `android/app/build.gradle.kts`
- Read: `android/.gitignore`

- [ ] **Step 1: Write the failing test**

Create tests that read repository files as UTF-8 and assert the behavior contract:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("release builds require an external non-Debug signing identity", () => {
  const gradle = read("android/app/build.gradle.kts");
  const ignore = read("android/.gitignore");

  assert.match(gradle, /HONGTAI_RELEASE_SIGNING_PROPERTIES/);
  assert.match(gradle, /signingConfigs[\s\S]*create\("release"\)/);
  assert.match(gradle, /release[\s\S]*signingConfig\s*=\s*signingConfigs\.findByName\("release"\)/);
  assert.match(gradle, /GradleException\("Release signing configuration is required/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|debug\.keystore|androiddebugkey/i);
  assert.match(ignore, /^\/keystore\.properties$/m);
  assert.match(ignore, /^\/\*\.jks$/m);
  assert.match(ignore, /^\/\*\.keystore$/m);
});

test("release tooling verifies the anchored certificate and signed APK", () => {
  for (const path of [
    "android/keystore.properties.example",
    "android/release-certificate.sha256",
    "scripts/init-android-release-signing.ps1",
    "scripts/build-android-release.ps1",
  ]) assert.equal(existsSync(join(root, path)), true, `${path} must exist`);

  const init = read("scripts/init-android-release-signing.ps1");
  const build = read("scripts/build-android-release.ps1");
  assert.match(init, /RandomNumberGenerator/);
  assert.match(init, /-storepass:env/);
  assert.match(init, /already exists/);
  assert.doesNotMatch(init + build, /debug\.keystore/);
  assert.match(build, /Android Debug/);
  assert.match(build, /apksigner/);
  assert.match(build, /Verified using v2 scheme[\s\S]*true/);
  assert.match(build, /Verified using v3 scheme[\s\S]*true/);
  assert.match(build, /release-certificate\.sha256/);
  assert.match(build, /Get-FileHash[\s\S]*SHA256/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec tsx --test tests/android-release-signing.test.ts
```

Expected: FAIL because the signing configuration, scripts, example and certificate anchor do not exist.

## Task 2: Implement the fail-closed Gradle signing contract

**Files:**
- Modify: `android/app/build.gradle.kts`
- Modify: `android/.gitignore`
- Create: `android/keystore.properties.example`

- [ ] **Step 1: Protect local secrets before generating any key**

Append exact Android-root patterns to `android/.gitignore`:

```gitignore
/keystore.properties
/*.jks
/*.keystore
/*.p12
```

The example file remains tracked because its name is `keystore.properties.example`.

- [ ] **Step 2: Load and validate signing inputs before `android {}`**

Add `java.util.Properties` and code with these exact semantics:

```kotlin
import java.util.Properties

val releaseSigningPath = providers.environmentVariable("HONGTAI_RELEASE_SIGNING_PROPERTIES").orNull
val releaseTaskRequested = gradle.startParameter.taskNames.any { taskName ->
  taskName.contains("Release", ignoreCase = true) &&
    listOf("assemble", "bundle", "package", "install", "validateSigning").any {
      taskName.contains(it, ignoreCase = true)
    }
}
val releaseSigningFile = releaseSigningPath?.let(::file)

if (releaseTaskRequested && (releaseSigningFile == null || !releaseSigningFile.isFile)) {
  throw GradleException("Release signing configuration is required via HONGTAI_RELEASE_SIGNING_PROPERTIES")
}

val releaseSigning = Properties()
if (releaseSigningFile?.isFile == true) {
  releaseSigningFile.inputStream().use(releaseSigning::load)
}

fun requiredReleaseSigningValue(name: String): String =
  releaseSigning.getProperty(name)?.takeIf(String::isNotBlank)
    ?: throw GradleException("Release signing configuration is missing required field: $name")
```

When properties are present, require `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`; require `storeFile` to be absolute and an existing file; reject `keyAlias=androiddebugkey` without printing any value or private path.

- [ ] **Step 3: Bind release to a non-Debug signingConfig and increment versionCode**

Inside `android {}`:

```kotlin
defaultConfig {
  versionCode = 4
  versionName = "0.0.1"
}

signingConfigs {
  if (releaseSigning.isNotEmpty()) {
    create("release") {
      val keyStore = file(requiredReleaseSigningValue("storeFile"))
      if (!keyStore.isAbsolute || !keyStore.isFile) {
        throw GradleException("Release signing keystore must be an existing absolute file")
      }
      val alias = requiredReleaseSigningValue("keyAlias")
      if (alias.equals("androiddebugkey", ignoreCase = true)) {
        throw GradleException("Release signing alias must not use the Android Debug identity")
      }
      storeFile = keyStore
      storePassword = requiredReleaseSigningValue("storePassword")
      keyAlias = alias
      keyPassword = requiredReleaseSigningValue("keyPassword")
      enableV1Signing = false
      enableV2Signing = true
      enableV3Signing = true
    }
  }
}

buildTypes {
  release {
    signingConfig = signingConfigs.findByName("release")
      ?: if (releaseTaskRequested) throw GradleException("Release signing configuration is required") else null
  }
}
```

Keep existing ProGuard and dependency configuration unchanged.

- [ ] **Step 4: Add the non-secret example**

Create `android/keystore.properties.example` with only keys and explanatory placeholders:

```properties
storeFile=C:/absolute/path/outside/repository/hongtai-release.jks
storePassword=replace-with-secret
keyAlias=hongtai-release
keyPassword=replace-with-secret
```

- [ ] **Step 5: Verify GREEN for the Gradle boundary and fail-closed behavior**

Run the focused Node test; it may still fail only on missing tooling/anchor assertions. Then run without the environment variable:

```powershell
$env:ANDROID_HOME = "C:\Users\AIMFl\AppData\Local\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Remove-Item Env:HONGTAI_RELEASE_SIGNING_PROPERTIES -ErrorAction SilentlyContinue
Push-Location android
.\gradlew.bat :app:assembleRelease --no-daemon
Pop-Location
```

Expected: FAIL with the safe `Release signing configuration is required` message before producing a new candidate. `:app:testDebugUnitTest` must still pass.

## Task 3: Add safe key initialization and deterministic release verification

**Files:**
- Create: `scripts/init-android-release-signing.ps1`
- Create: `scripts/build-android-release.ps1`
- Create after initialization: `android/release-certificate.sha256`

- [ ] **Step 1: Implement the one-time initializer**

The initializer must:

- use `$ErrorActionPreference = "Stop"`;
- default the signing directory to `%APPDATA%\HongTai-AI-Agent\signing` and accept an explicit `-SigningDirectory`;
- resolve JDK 21 `keytool` from `JAVA_HOME` or Android Studio JBR;
- refuse to continue if the keystore or properties target already exists;
- create independent 48-byte random store/key passwords with `RandomNumberGenerator.Fill`;
- pass passwords to `keytool` only through temporary environment variables and `-storepass:env` / `-keypass:env`;
- generate alias `hongtai-release`, RSA 3072, SHA256withRSA, validity 10000 days, and `CN=HongTai AI Agent Release,O=HongTai AI Agent,C=CN`;
- write the properties file with a forward-slash absolute `storeFile` and UTF-8 without BOM;
- restrict the directory ACL to the current user, SYSTEM and Administrators;
- export the public DER certificate and print only the properties path plus its SHA-256;
- clear temporary password environment variables in `finally`.

Use a helper with this behavior for random secrets:

```powershell
function New-RandomSecret {
  $bytes = [byte[]]::new(48)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
```

- [ ] **Step 2: Implement the release builder/verifier**

The builder must accept `-SigningProperties`, default to `HONGTAI_RELEASE_SIGNING_PROPERTIES` or the initializer's standard path, and:

1. locate JDK 21 and Android SDK without persisting machine paths;
2. choose the highest installed build-tools directory containing all three verification tools;
3. set the signing properties environment variable only for the child Gradle process;
4. run `pnpm --filter @hongtai/web build`, `pnpm exec cap sync android`, and Gradle `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease --no-daemon`;
5. require exactly `android/app/build/outputs/apk/release/app-release.apk` as the final candidate;
6. run `zipalign -c -P 16 -v 4`, `aapt2 dump badging`, and `apksigner verify --verbose --print-certs`;
7. require v2 and v3 verification lines to be true, reject any signer DN containing `Android Debug`, normalize the signer SHA-256 and compare it to `android/release-certificate.sha256`;
8. require package `com.hongtai.aiagent`, versionCode `4`, versionName `0.0.1`;
9. print only public artifact path, package/version, signer DN/fingerprint and APK SHA-256.

Use `try/finally` to restore the caller's environment variable. Never echo properties contents or Gradle command-line secret values.

- [ ] **Step 3: Run the initializer once and anchor the public certificate**

Run the initializer with its default external directory. Capture the printed public certificate SHA-256, normalize it to 64 lowercase hexadecimal characters, and add exactly that one line to `android/release-certificate.sha256` using `apply_patch`. Re-running the initializer must fail with `already exists` and leave both files unchanged.

- [ ] **Step 4: Run focused GREEN tests**

Run:

```powershell
pnpm exec tsx --test tests/android-release-signing.test.ts
```

Expected: both tests pass. Then run the release builder with the external properties path and require all host-side checks to pass.

## Task 4: Document the signing and upgrade contract

**Files:**
- Create: `docs/Android发布签名与升级指南.md`
- Modify: `docs/文档索引.md`
- Modify: `README.md`
- Modify after evidence: `docs/当前能力与发布状态.md`
- Create after evidence: `docs/验收/2026-08-10-android-release-signing.md`

- [ ] **Step 1: Write the operational guide**

Document:

- the initializer and build commands without secret values;
- the four property names and external-file requirement;
- public certificate anchor and backup responsibility;
- fail-closed behavior;
- host verification commands and artifact identity;
- Debug→release signature mismatch as an expected reinstall boundary;
- same-release-certificate upgrade procedure without `-d` or uninstall;
- Play App Signing/CI as future deployment choices, not current facts;
- recovery rule: loss of the first externally distributed signing key prevents normal updates.

- [ ] **Step 2: Link the guide from README and the document index**

Keep the Debug build instructions intact. Add a concise formal-candidate section pointing to the guide and state that a signed release variant does not by itself prove all release gates or physical-device coverage.

- [ ] **Step 3: Update current status only from actual evidence**

After build/Android verification, change Issue #5 from “no release signing chain” to the exact observed state. Keep the overall APK non-distributable while Issues #6–#29 and any missing physical-device evidence remain open.

- [ ] **Step 4: Add dated acceptance evidence**

Record only observed public facts:

- commit under test;
- APK path, package, version, SHA-256;
- public signer DN and certificate SHA-256;
- v2/v3 and zipalign results;
- fail-closed result without configuration;
- emulator/device model, API, serial classification, install and upgrade results;
- private sample byte count/hash without sample contents;
- explicit physical-device boundary.

Do not edit the 2026-08-08 or 2026-08-09 historical QA records.

## Task 5: Android same-signature upgrade acceptance

**Files:**
- Temporary workspace outside the repository for the versionCode 3 baseline
- Candidate: `android/app/build/outputs/apk/release/app-release.apk`
- Evidence: `docs/验收/2026-08-10-android-release-signing.md`

- [ ] **Step 1: Start the dedicated API 35 emulator**

Start `SciChatApi35` hidden/headless, wait by polling `sys.boot_completed`, and explicitly capture `ro.kernel.qemu=1`, model, API and serial. Do not use an unrelated running device.

- [ ] **Step 2: Build a protected baseline without changing repository history**

Copy the repository to a newly created temporary directory outside the workspace while excluding `.git`, `node_modules`, `android/.gradle` and build outputs. Patch only the copied `versionCode = 4` to `versionCode = 3`, use the same external signing properties and run the release build there. Preserve the baseline APK and its SHA-256 in the temporary acceptance directory.

- [ ] **Step 3: Prove ordinary upgrade and data preservation**

On the explicit emulator serial:

1. install the v3 release baseline;
2. create `files/issue5-release-upgrade-sample.txt` with fixed non-personal bytes using `run-as`;
3. record file byte count/hash, package version, certificate digest and `firstInstallTime`;
4. install v4 with `adb install -r`, never `-d` and never uninstall;
5. verify candidate version, identical signer digest, unchanged `firstInstallTime`, updated `lastUpdateTime`, and identical sample hash;
6. force-stop and cold-start `com.hongtai.aiagent/.MainActivity`, then require a live PID.

- [ ] **Step 4: Keep truth boundaries explicit**

Record this as API 35 emulator evidence. If no physical device is connected, state that physical-device release upgrade remains unverified and do not claim physical-device completion.

## Task 6: Review, verify and commit Issue #5

**Files:** all Issue #5 paths listed in the task contract

- [ ] **Step 1: Run focused and baseline verification once**

Run:

```powershell
pnpm exec tsx --test tests/android-release-signing.test.ts tests/android-plugin-boundary.test.ts
pnpm check
pnpm --filter @hongtai/web build
```

Run Android release tests/lint/build through `scripts/build-android-release.ps1`. Do not repeat expensive Android E2E after unchanged code.

- [ ] **Step 2: Run repository hygiene gates**

- strict UTF-8 decode and U+FFFD scan for changed text files;
- `git diff --check`;
- verify no tracked `.jks`, `.keystore`, `.p12`, local properties or generated APK;
- scan changed/staged content for password assignments, private key blocks, Authorization, API keys and secret values;
- verify only Issue #5 files changed.

- [ ] **Step 3: Run spec compliance review, then code quality review**

Reviewers must inspect actual code and evidence, not trust the implementer report. Fix every Critical/Important issue and re-run the corresponding review before proceeding.

- [ ] **Step 4: Create the local implementation commit**

Stage only exact Issue #5 paths, run `git diff --cached --check`, and commit:

```powershell
git commit -m "feat(android): establish release signing chain"
```

Do not push. Report the commit SHA and the external signing-material path without disclosing credentials.
