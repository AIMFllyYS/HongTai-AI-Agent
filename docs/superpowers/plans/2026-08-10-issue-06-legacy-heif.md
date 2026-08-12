# Issue #6 Legacy Android HEIF/HEIC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirmed static HEVC HEIF/HEIC photos importable on API 24/25 through a pinned, decoder-only native fallback while preserving the platform decoder on API 26+ and for JPEG/PNG/WebP.

**Architecture:** Keep one `PrivateObservationImageNormalizer` entry point in Android I/O. A bounded byte probe becomes the format authority; a small selector routes only API 24/25 confirmed HEIF to a JNI adapter. The adapter dynamically links pinned libheif/libde265 shared libraries and returns an already-oriented bitmap to the existing JPEG staging/atomic-publication path. Existing `PhotoOperationStateStore`, bridge DTOs and UI remain unchanged.

**Tech Stack:** Kotlin/JVM and Android instrumentation tests, C++17/JNI, CMake `3.22.1`, Android NDK `28.2.13676358`, libheif `v1.23.1` commit `2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0`, libde265 `v1.1.1` commit `4dd701fffac01632ffd5cabc5ef10deb56accba1`, Gradle/AGP, PowerShell, ADB and API 24/25/26/35 AVDs.

---

## Task contract

### Goal

- User-visible result: on Android 7.0/7.1, a real confirmed HEIC/HEIF chosen through the existing system document picker becomes the same safe private JPEG used by the observation flow, with no permanent busy state.

### Allowed changes

- `android/app/src/main/java/com/hongtai/aiagent/media/PrivateMediaStore.kt`
- New focused Kotlin files under `android/app/src/main/java/com/hongtai/aiagent/media/heif/`
- New JNI/CMake files under `android/app/src/main/cpp/heif/`
- `android/app/build.gradle.kts`, `android/gradle.properties`, root Android CMake/native dependency metadata as narrowly required
- New Android JVM and instrumentation tests/assets for the format probe, selector, decoder, orientation, limits and cleanup
- `tests/android-heif-native-boundary.test.ts`
- New pinned-source fetch/verify script and third-party lock, license, SBOM/source-offer files
- `README.md`, `docs/文档索引.md`, `docs/当前能力与发布状态.md`, a focused Android HEIF build/operation guide, and a dated Issue #6 acceptance record

### Explicit non-goals

- No provider-only compatibility claim, old Maven AAR, static LGPL linkage, runtime encoder, AVIF, animated HEIF, remote transcoding, UI/DTO/AI Flow change, new media permission, API 23 support, or CLI `sharp` change.
- Do not rewrite the 2026-08-08/09 historical acceptance records.
- Do not claim physical-device or all-ABI runtime validation from x86/x86_64 AVD evidence.

### Architecture owner and source of truth

- Owner: Android I/O and native build layer.
- Format authority: bounded bytes in the app-private staged source, never provider MIME or extension alone.
- Import state authority: existing `PhotoOperationStateStore` and `FileMediaPlugin` terminal handling.
- Native dependency authority: checked-in lock manifest containing exact tag, commit, source archive SHA-256, patch SHA-256, build flags and license metadata.
- Final artifact authority: private JPEG dimensions/hash plus instrumentation assertions and PackageManager/APK native-library inspection.

### Execution preflight already observed

- The current host has NDK `28.2.13676358`, CMake `3.22.1`, Android 24/25 platforms and `default;x86_64` API 24/25 system images installed.
- The host dependency blocker is therefore cleared. No dedicated API 24/25 AVD has yet been created or booted, and no endpoint result may be inferred from installation alone.
- Check API 26 system-image availability before Task 7 and install it only if missing; the existing API 35 environment remains a regression target, not a substitute for API 24/25.

## Task 1: Write failing format-probe and routing tests

**Files:**
- Create: `android/app/src/test/java/com/hongtai/aiagent/media/ImageFormatProbeTest.kt`
- Create: `android/app/src/test/java/com/hongtai/aiagent/media/ObservationImageDecoderSelectorTest.kt`
- Modify: `android/app/src/test/java/com/hongtai/aiagent/media/PrivateMediaImportPolicyTest.kt`
- Read: `android/app/src/main/java/com/hongtai/aiagent/media/PrivateMediaStore.kt`

- [ ] **Step 1: Add RED tests for byte authority**

Cover JPEG, PNG and WebP magic; a structurally valid HEIF `ftyp`; extended-size boxes; truncated/overflow/zero-size boxes; AVIF brands; a PNG named `.heic`; HEIF bytes reported as `image/jpeg`; and text reported as `image/heic`. Assert provider MIME and filename cannot turn unknown bytes into a supported image.

- [ ] **Step 2: Add RED tests for bounded probing and limits**

Use partial-read streams and files larger than the probe window. Assert at most 64 KiB and 64 top-level boxes are inspected, arithmetic overflow is rejected, and no whole source file is loaded into memory.

- [ ] **Step 3: Add RED selector tests**

Use fake platform/native decoders and explicit SDK integers. Assert:

- API 24/25 confirmed HEIF calls native exactly once;
- API 26+ confirmed HEIF calls platform exactly once;
- JPEG/PNG/WebP call platform at every supported API;
- unknown/AVIF never call either decoder;
- a fallback result marked already oriented skips the common EXIF transform;
- native unavailable, invalid, over-limit and allocation failures surface as stable existing exception classes.

- [ ] **Step 4: Run the focused tests and capture RED**

Run `:app:testDebugUnitTest` with the Issue #5 signing environment absent. Expected: only new tests fail to compile or assert because probe/selector types do not exist; release signing must not block JVM tests.

## Task 2: Implement bounded format authority and one decoder selector

**Files:**
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/ImageFormatProbe.kt`
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/ObservationImageDecoder.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/media/PrivateMediaStore.kt`
- Test: files from Task 1

- [ ] **Step 1: Implement the pure bounded probe**

Return a small sealed format value (`JPEG`, `PNG`, `WEBP`, `HEIF_CANDIDATE`, `UNSUPPORTED`) from bytes. Parse `ftyp` structurally with checked `Long` arithmetic and the 64 KiB/64-box budgets from the design. Keep MIME/name only as non-authoritative metadata for diagnostics; do not log them.

- [ ] **Step 2: Replace MIME-first acceptance**

After the existing bounded copy completes, probe `stagedSource` and choose the source format from bytes. Remove `.heic`/provider-only acceptance from `imageMimeType`; preserve its API only if two real callers still need it, otherwise replace it rather than leaving parallel truth sources.

- [ ] **Step 3: Add one injectable selector**

Keep `PrivateObservationImageNormalizer.normalize` as the single orchestrator. Inject platform and legacy decoder ports only where tests require it; production uses the SDK-gated selector. Do not expose decoder choice through Capacitor or create a new Flow.

- [ ] **Step 4: Keep ordinary images unchanged**

Platform decoding, max-edge scaling, white flattening, JPEG quality, `fsync`, same-directory rename and cleanup remain one shared tail. Confirm JPEG/PNG/WebP unit tests are still green before native code exists.

- [ ] **Step 5: Run focused GREEN tests**

Run the Task 1 JVM tests. Expected: probe and routing policy pass with fake decoders; actual API 24/25 HEIF decode remains pending.

## Task 3: Lock and verify the native source supply chain

**Files:**
- Create: `android/native-deps/heif-lock.json`
- Create: `scripts/fetch-android-heif-sources.ps1`
- Create: `tests/android-heif-native-boundary.test.ts`
- Create: `android/third_party/heif/LICENSES/libheif-LGPL-3.0.txt`
- Create: `android/third_party/heif/LICENSES/libde265-LGPL-3.0.txt`
- Create: `android/third_party/heif/NOTICE.md`
- Create: `android/third_party/heif/sbom.spdx.json`
- Create or modify: the narrow ignore file for downloaded/extracted native sources

- [ ] **Step 1: Write the RED repository boundary test**

Assert the exact two tags/commits, 64-hex archive hashes, NDK version, four ABI list, API 24, decoder-only flags, dynamic-library intent, 16 KiB linker checks, license files, SBOM and source-offer text. Assert no `.aar`, prebuilt opaque `.so`, encoder flag or unpinned URL is tracked.

- [ ] **Step 2: Populate archive hashes from actual downloads**

Download each upstream commit archive once to a newly created temporary directory, calculate SHA-256, independently confirm the archive resolves to the required commit, and write the observed hashes to the lock file. Never invent or truncate a digest.

- [ ] **Step 3: Implement fail-closed fetching**

The PowerShell script reads only the lock file, downloads to a temporary file, verifies SHA-256 before extraction, rejects symlink/path traversal/duplicate archive entries, verifies the extracted revision markers, then atomically publishes to an ignored local cache. It accepts a pre-populated archive directory for offline builds. CMake/Gradle must not download implicitly.

- [ ] **Step 4: Add complete LGPL delivery material**

Copy license text from the pinned archives, retain copyright notices, list public corresponding-source URLs and hashes, document dynamic replacement/relink steps and any repository patch, and produce an SPDX SBOM matching the lock. Mark any future written source offer as a formal-distribution responsibility with owner/contact/validity fields that cannot be left as fake placeholders in a distributable build.

- [ ] **Step 5: Verify hashes, UTF-8 and source-cache hygiene**

Run the fetch twice: first success, then deterministic no-op after hash verification. Corrupt a copy in a temporary directory and require rejection without replacing the good cache. Confirm no archives, extracted source, secrets or local absolute paths are tracked.

## Task 4: Build decoder-only shared libraries for four ABIs

**Files:**
- Create: `android/app/src/main/cpp/heif/CMakeLists.txt`
- Create: focused CMake toolchain/config modules under `android/app/src/main/cpp/heif/cmake/` only if needed
- Modify: `android/app/build.gradle.kts`
- Modify: `android/gradle.properties` only if a documented native build setting is required
- Test: `tests/android-heif-native-boundary.test.ts`

- [ ] **Step 1: Configure the fixed NDK/CMake contract**

Set `ndkVersion = "28.2.13676358"`, CMake version `3.22.1`, native min API 24 and ABI filters `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`. Point CMake only at the verified local source cache; absent or mismatched sources fail with a safe instruction to run the fetch script.

- [ ] **Step 2: Configure decoder-only libde265/libheif**

Build libde265 and libheif as `SHARED`; enable only libde265 HEVC decode and disable all encoders, command-line tools, examples, tests, AOM/dav1d, JPEG/OpenJPEG, FFmpeg and unrelated plugins. Use only option names confirmed in the pinned commits, and make unused/manual variables a configuration error.

- [ ] **Step 3: Add 16 KiB and symbol visibility settings**

Compile the JNI layer as C++17 with hidden visibility, warnings-as-errors for first-party C++, RELRO/NOW and stack protection where supported. Link every shipped `.so` with `-Wl,-z,max-page-size=16384`; do not use LTO across LGPL library boundaries.

- [ ] **Step 4: Build all ABIs and inspect actual outputs**

Build Debug once for all four ABIs. Use NDK `llvm-readelf` to require 16 KiB-compatible `LOAD` alignment and inspect `DT_NEEDED` so `libhongtai_heif.so -> libheif.so -> libde265.so` remains dynamic. Inspect the APK for exactly the intended libraries in all four ABI directories and run 16 KiB APK alignment verification.

- [ ] **Step 5: Run the repository boundary test GREEN**

Run `pnpm exec tsx --test tests/android-heif-native-boundary.test.ts`. Expected: pins, license/SBOM, decoder-only flags, ABI/API and packaging assertions pass.

## Task 5: Implement the JNI decoder with RAII and hard limits

**Files:**
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/heif/LegacyHeifDecoder.kt`
- Create: `android/app/src/main/java/com/hongtai/aiagent/media/heif/LegacyHeifContracts.kt`
- Create: `android/app/src/main/cpp/heif/legacy_heif_jni.cpp`
- Create: focused RAII/header files only when they own a real independent native responsibility
- Modify: `android/app/src/main/java/com/hongtai/aiagent/media/ObservationImageDecoder.kt`
- Test: Task 1 tests plus new native boundary tests

- [ ] **Step 1: Define a small stable JNI contract**

Accept only the app-private staged file and immutable decode limits. Return a bitmap/result marked `orientationApplied=true`; never return native pointers or decoder error strings across the bridge. Load `hongtai_heif` only inside the API 24/25 fallback path so API 26+ and ordinary images do not depend on it at runtime.

- [ ] **Step 2: Apply all limits before allocation**

Require source bytes in `1..15 MiB`, dimensions in `1..8192`, total source pixels at most `16,777,216`, output edge at most 3072, output pixels at most `9,437,184` and RGBA bytes at most 36 MiB. Use checked 64-bit multiplication/addition before any cast. Configure libheif security limits, bounded thread count and one static primary image; reject AV1, sequence/animation, external reference and missing HEVC decoder.

- [ ] **Step 3: Use RAII for every native resource**

Wrap context, image handle, decoded image, Android bitmap lock/local refs and file access. Translate libheif failures, `std::bad_alloc` and JNI exceptions to a small enum. Every exit path must unlock/release exactly once and must not call `abort`.

- [ ] **Step 4: Apply HEIF transforms exactly once**

Allow libheif to apply `irot`/`imir`; mark the result as oriented. The shared tail scales/flattens/compresses but skips `ExifInterface` for this result. Platform images retain the existing one-time EXIF path.

- [ ] **Step 5: Map failures into existing terminal semantics**

Map byte/pixel limits to `PrivateMediaTooLargeException`, invalid/unsupported content to `PrivateImageInvalidException`, and packaging/library faults to a private import exception. Catch `LinkageError` at the Kotlin boundary. Do not change `NativeIssueCode` unless a genuinely new user action exists.

- [ ] **Step 6: Run JVM and native compile checks**

Run `:app:testDebugUnitTest`, native Debug compilation and `:app:compileDebugAndroidTestKotlin`. Expected: fake-decoder policy tests pass and all four native variants compile; no AVD claim yet.

## Task 6: Add provenance-complete real fixtures and instrumentation

**Files:**
- Create: `android/app/src/androidTest/assets/heif/PROVENANCE.md`
- Create: `android/app/src/androidTest/assets/heif/fixtures.sha256`
- Create: small HEIC/HEIF fixtures under that directory
- Create: deterministic fixture source/generation script under `android/app/src/androidTest/assets/heif/generator/`
- Modify: `android/app/src/androidTest/java/com/hongtai/aiagent/media/PrivateMediaStoreInstrumentationTest.kt`
- Create: focused decoder instrumentation test if splitting gives one clear responsibility

- [ ] **Step 1: Generate synthetic fixtures outside the app runtime**

Create an asymmetric, non-square color-grid source from a checked-in deterministic script. Encode a baseline and an `irot`/`imir` case with a pinned host encoder; record exact tool versions/commits, commands, source/output hashes, rights, expected dimensions and pixel coordinates. The encoder is test generation only and is not linked into the APK.

- [ ] **Step 2: Add deterministic negative fixtures**

Generate truncated box, overflow box, unsupported AVIF-brand and declared-over-limit cases from the synthetic source through checked-in mutation steps. Do not include a user photo or unidentified internet fixture.

- [ ] **Step 3: Test actual fallback decode on device**

On API 24/25, import fixture bytes through the same private normalizer, assert non-empty JPEG, longest edge <=2048, expected orientation/corner pixels, MIME `image/jpeg`, no `.source`/`.part` leftovers, and one terminal result. Exercise corrupt, oversized and simulated native-unavailable paths and verify stable codes/cleanup.

- [ ] **Step 4: Prove API 26+ uses the platform path**

Use an injected native decoder that throws if called, then run confirmed HEIF on API 26+ and assert platform success. Also keep JPEG/PNG/WebP instrumentation green on API 24+.

- [ ] **Step 5: Compile instrumentation before E2E**

Run `:app:compileDebugAndroidTestKotlin` and the JVM suite. This is basic verification only; do not repeatedly run all AVDs before implementation stabilizes.

## Task 7: Run real Android endpoint acceptance

**Files:**
- Candidate APK and test APK from the unchanged implementation commit
- Create after observed evidence: `docs/验收/2026-08-10-android-7-heif.md`

- [ ] **Step 1: Create dedicated AVDs**

Use the already installed `default;x86_64` API 24/25 images to create clean, task-specific AVDs; create an API 26 AVD after verifying/installing its system image, and use a dedicated/read-only API 35 AVD. Record serial, `ro.kernel.qemu=1`, API, model, ABI, system-image identifier and cold-boot state. Never reuse or wipe an unrelated running emulator. Successful creation and boot are still acceptance steps, not preflight facts.

- [ ] **Step 2: Run API 24 real user path**

Install the unchanged candidate without downgrade flags. Copy the provenance fixture into a public test-only location, register it with the platform media/document provider, open the observation page, invoke the existing gallery action, and select it through system DocumentsUI. Require visible preview, released importing state, ability to continue, one private JPEG with expected dimensions/orientation/hash properties, and no temporary files or native crash/ANR.

- [ ] **Step 3: Repeat independently on API 25**

Cold-install and repeat the same DocumentsUI flow, instrumentation fixture suite, process cold start and cleanup assertions. API 24 success is not substituted for API 25 evidence.

- [ ] **Step 4: Regress API 26 and API 35**

On API 26, select confirmed HEIF and prove platform-path success; on API 35, select a normal JPEG/PNG/WebP and one confirmed HEIF. Run the selector instrumentation seam to prove native fallback was not called on API 26+. Confirm the app remains responsive and the observation preview contract is unchanged.

- [ ] **Step 5: Collect bounded evidence**

Record public fixture SHA-256, APK SHA-256, package/version, AVD facts, instrumentation counts, output JPEG size/dimensions, screenshots and sanitized crash/ANR scan. Do not record private absolute app paths, media bytes or unrelated device data.

- [ ] **Step 6: Preserve truth boundaries**

State which emulator ABI actually ran. If no physical API 24/25 device is connected, write exactly that physical Android 7.x, ARM runtime, OEM HEIC and real low-memory behavior remain unverified.

## Task 8: Update live documentation from actual evidence

**Files:**
- Create: a focused `docs/Android旧系统HEIF兼容与依赖指南.md`
- Modify: `README.md`
- Modify: `docs/文档索引.md`
- Modify: `docs/当前能力与发布状态.md`
- Create: `docs/验收/2026-08-10-android-7-heif.md`

- [ ] **Step 1: Document build and LGPL operations**

Explain pinned-source fetch/offline verification, NDK/CMake prerequisites, four-ABI build, 16 KiB inspection, SBOM/licenses, corresponding-source delivery and dynamic replacement boundary. Commands must contain no private machine path or secret.

- [ ] **Step 2: Update current capability only after endpoint evidence**

Replace “API 26+ only” with the exact observed API 24/25 AVD fallback and API 26+/35 regression facts. Keep physical devices, OEM photos and formal distribution gates explicit. Do not imply AVIF or sequence support.

- [ ] **Step 3: Add dated acceptance evidence**

Record commit under test, fixture provenance/hash, AVD/API/ABI, UI steps, instrumentation results, JPEG properties, APK/native-library checks, 16 KiB proof and failures exercised. Historical acceptance files remain unchanged.

- [ ] **Step 4: Link without duplicating**

README and document index point to the focused guide and current status; detailed commands, current facts and historical evidence remain in their respective documents.

## Task 9: Basic verification, review and local commit

**Files:** all exact Issue #6 paths above

- [ ] **Step 1: Run one focused basic verification pass**

Run:

```powershell
pnpm exec tsx --test tests/android-heif-native-boundary.test.ts tests/android-plugin-boundary.test.ts
pnpm check
Push-Location android
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon
Pop-Location
```

Then run the pinned-source hash verifier, four-ABI ELF/16 KiB/APK checks and instrumentation compilation. Do not repeat the full API 24/25/26/35 endpoint matrix after unchanged code.

- [ ] **Step 2: Reconfirm release packaging**

Using the external Issue #5 signing properties without exposing values, run the repository release builder once. Confirm the new native libraries are present for four ABIs, release signature/zip alignment remains valid, and `versionCode` is not changed again solely for this internal loop unless a new distributed candidate is intentionally created.

- [ ] **Step 3: Run repository hygiene gates**

- strict UTF-8 decode and U+FFFD scan for changed text files;
- `git diff --check` and Android resource/JSON validation;
- no tracked source archives, extracted caches, generated `.so`, `.aar`, APK, user media, secrets or private paths;
- SBOM/lock/license/source-offer consistency and actual archive hash verification;
- only exact Issue #6 files staged.

- [ ] **Step 4: Run spec compliance review, then code quality/security review**

Reviewers inspect actual source, native flags, dependency graph, RAII, overflow, cleanup, orientation, AVD evidence and LGPL material. Fix every Critical/Important issue and rerun the corresponding review. Do not accept a provider-MIME-only test as endpoint proof.

- [ ] **Step 5: Create the local implementation commit**

Stage exact Issue #6 paths, run `git diff --cached --check`, and commit locally with a scoped message such as:

```powershell
git commit -m "feat(android): support HEIF on API 24 and 25"
```

Do not push. Report commit SHA, fixture provenance, actual AVD/API/ABI coverage, APK hash, source archive hashes and the physical-device boundary.
