# Android APK Versioned Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Debug and Release APK names, retain every verified version without overwrite, and build v0.1.7/code15 artifacts.

**Architecture:** Gradle output remains temporary. A small PowerShell archive command copies a verified APK into `output/apk-archive/` using the APK `versionName` and build variant; it is idempotent for identical bytes and fail-closed for a conflicting same-name file. Debug and Release build entrypoints perform their own appropriate verification before invoking that shared archive boundary.

**Tech Stack:** PowerShell 7/Windows PowerShell, Gradle/AGP, Capacitor, TypeScript `node:test`, Android build-tools.

---

### Task 1: Freeze version and archive contracts with failing tests

**Files:**
- Modify: `tests/android-version-lineage.test.ts`
- Create: `tests/android-apk-archive.test.ts`

- [ ] Add assertions for `versionName = "0.1.7"`, `versionCode = 15`, both canonical names, the fixed archive directory, and refusal to overwrite a different hash.
- [ ] Run `node_modules\.bin\tsx.CMD --test tests\android-version-lineage.test.ts tests\android-apk-archive.test.ts`.
- [ ] Confirm failure is caused by the repository still declaring `0.1.6/14` and missing archive scripts.

### Task 2: Implement the minimal archive and Debug build entrypoints

**Files:**
- Create: `scripts/archive-android-apk.ps1`
- Create: `scripts/build-android-debug.ps1`
- Modify: `scripts/build-android-release.ps1`

- [ ] Implement parameters `SourceApk`, `Variant`, `VersionName`, and optional `ArchiveRoot`.
- [ ] Construct only `HongTai-AI-Agent-$Variant-v$VersionName.apk` where variant is `debug` or `release`.
- [ ] Compute source and destination SHA-256. Return an identical destination; throw when the destination exists with a different hash; otherwise use `Copy-Item` without `-Force`.
- [ ] Make Debug run Web build, Capacitor sync, Debug unit tests, lint and assemble; verify package/version and Debug identity; then archive.
- [ ] Make Release call the same archive command only after existing package, zipalign, v2/v3 and certificate checks pass.
- [ ] Re-run the two directed tests and confirm they pass.
- [ ] Commit exact script and test paths with `feat(release): preserve versioned apk artifacts`.

### Task 3: Advance Android to v0.1.7/code15

**Files:**
- Modify: `android/app/build.gradle.kts`
- Modify: `scripts/build-android-release.ps1`
- Modify: `tests/android-plugin-boundary.test.ts`
- Modify: `tests/android-version-lineage.test.ts`

- [ ] Change only `versionName` to `0.1.7` and `versionCode` to `15`.
- [ ] Update hard release identity checks and version tests to the same values.
- [ ] Run the directed Android version tests and confirm pass.
- [ ] Commit exact paths with `chore(release): prepare v0.1.7 code 15`.

### Task 4: Document the permanent rule and release history

**Files:**
- Create: `docs/APK产物命名与归档规范.md`
- Modify: `AGENTS.md`
- Modify: `docs/架构与工程规范.md`
- Modify: `docs/Android发布签名与升级指南.md`
- Modify: `docs/文档索引.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/web/src/pages/ApplicationInfoPage.tsx`

- [ ] State canonical Debug/Release names and `output/apk-archive/` as the local archive.
- [ ] State that different bytes may never replace an existing version filename.
- [ ] Explain that Gradle output is temporary and test APKs are excluded.
- [ ] Summarize v0.1.6 and historical versions without rewriting historical evidence.
- [ ] Add the v0.1.7 version-management change to app information and CHANGELOG.
- [ ] Run document links, UI text tests, UTF-8 and `git diff --check`.
- [ ] Commit exact paths with `docs: standardize apk naming and retention`.

### Task 5: Archive verifiable historical APKs and build v0.1.7

**Files:**
- Local only: `output/apk-archive/*.apk`
- Create: `docs/验收/2026-08-14-v017-apk-archive.md`
- Modify: `docs/当前能力与发布状态.md`

- [ ] Copy only existing APKs whose package identity, variant, version and hash can be independently read; do not relabel the withdrawn wrong-identity v0.1.5 file as valid.
- [ ] Run `scripts/build-android-debug.ps1` and verify `HongTai-AI-Agent-debug-v0.1.7.apk`.
- [ ] Run `scripts/build-android-release.ps1` with the existing external signing configuration and verify `HongTai-AI-Agent-release-v0.1.7.apk`.
- [ ] Re-run archive commands to prove identical files are idempotent and use a temporary conflicting file to prove overwrite rejection.
- [ ] Record source commit, sizes, SHA-256, package/version, signatures and physical-device boundary.

### Task 6: Full verification and evidence commit

**Files:**
- Modify: `docs/验收/2026-08-14-v017-apk-archive.md`
- Modify: `docs/当前能力与发布状态.md`

- [ ] Run affected tests, `pnpm check`, `pnpm --filter @hongtai/web build`, Android Release tests/lint/build, and API 35 smoke checks where available.
- [ ] Run strict UTF-8/U+FFFD, API-key pattern, `git diff --check`, APK identity, signature and SHA-256 checks.
- [ ] Ensure only local APK/evidence directories remain untracked and `HongTai.zip` is unchanged.
- [ ] Commit documentation evidence with `docs(release): verify v0.1.7 apk archive`.
- [ ] Do not push, merge, upload, or change the public download page without the existing physical-device/publication gates.
