# P0 Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the independently verified P0 photo, link-diagnostic, and normal-upgrade branches into `main`, while closing the remaining photo-picker recovery and camera-staging gaps without broadening the APK architecture.

**Architecture:** React continues to use `AppRuntime`; Capacitor maps stable DTO/error contracts; Kotlin owns only photo-picker URI grants, capture staging, and bounded I/O. The active photo operation remains the one persisted authority across an external Activity or process recreation; no background service, new permission, second state machine, or cloud component is introduced.

**Tech Stack:** TypeScript/Node test runner, React, Capacitor 8, Kotlin/Android, Gradle, Android Photo Picker and Storage Access Framework.

---

## 任务契约

## 目标

- 用户可感知的结果：选择或拍摄照片不会在大图导入时卡住主线程；外部 Activity 返回丢失时会显示可解释失败；已取得的系统选图读取授权能够支持进程重建后的私有导入；链接失败显示安全、稳定的诊断；已有 QA v2 可正常升级到 v3。

## 允许修改

- `android/app` 照片选择、捕获、错误码和网络诊断实现及其测试。
- `packages/core`、`packages/capacitor-runtime` 的既有 DTO/错误映射。
- `apps/web` 的既有通知与观察页恢复消费。
- `tests/`、`docs/验收/`、`docs/错误码与前端通知约定.md`、`docs/当前能力与发布状态.md`。

## 明确不做

- 不新增广泛相册/相机权限、后台服务、自动续跑、云端后端、登录或数据库。
- 不配置或伪造团队 release keystore；不把 Debug QA 结果称为正式 release 或真机验收。
- 不修改用户的 `HongTai.zip`，不 push、不关闭 Issue。

## 架构归属

- 所属层：Android I/O、Capacitor 组合、core DTO/错误、UI 展示。
- 依赖方向：页面只使用 `AppRuntime`；Capacitor 不复制 Flow；Kotlin 不决定平台解析、Prompt 或页面业务文案。

## 权威状态与数据

- `PhotoOperationStateStore` 是短生命周期照片操作的唯一持久状态；只保存控制元数据和一次性终态，不保存媒体字节。
- `taskId` 的七阶段状态仍由共享 Pipeline 负责；`sessionId` 的观察状态仍由诊断服务负责。
- 选图 URI 只在原生层短暂持有：取得持久读取授权后导入私有目录，成功或失败后释放授权；相机 staging 文件只在未导入期间存在。

## 验收

- 定向测试：新增照片授权/清理边界测试、Android JVM 测试、Capacitor/core/Web 定向测试。
- 构建 / lint：`pnpm check`、Web build、Gradle 单测/lint/debug APK。
- 浏览器或真机证据：最终 APK 的正常 v2→v3 模拟器升级；照片与链接仅报告实际完成的模拟器或真机证据。
- 用户实际会看到什么：照片操作完成、取消或被中断都进入可解释状态；链接失败显示稳定的安全诊断；正常安装升级保留应用数据。

## 交付说明

- 改了什么：合并 #1–#4，补强 URI 授权和 capture staging 清理，统一错误契约和活文档。
- 刻意没有做什么：未引入后台执行器或正式签名。
- 剩余风险或新增 Issue：物理机、OEM、HEIF API 24–25、正式签名链和后台长任务仍按现有 Issue 保留。

### Task 1: Verify integration ancestry and contract overlap

**Files:**
- Inspect: `android/app/src/main/java/com/hongtai/aiagent/bridge/NativeIssueCode.kt`
- Inspect: `packages/core/src/models.ts`
- Inspect: `tests/android-plugin-boundary.test.ts`

- [x] **Step 1: Verify the shared base and clean candidate ranges**

Run: `git merge-base 8d20ad9 codex/p0-photo-reliability`, then repeat for the link and upgrade branches; run `git diff --check` for each range.

Expected: each merge base is `8d20ad9f657fd57baab0506ff86b2dcfc6a7fece` and no whitespace errors.

- [x] **Step 2: Record the union that the main branch must retain**

Retain photo `ERR_MEDIA_SELECTION_CANCELLED`/recovery codes, link `ERR_LINK_*` codes and `NativeLinkDiagnosticV1`, plus the v3 versionCode assertion. Do not resolve an overlap by choosing one branch wholesale.

### Task 2: Reproduce the missing durable picker grant with a failing boundary test

**Files:**
- Modify: `tests/android-plugin-boundary.test.ts`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`

- [x] **Step 1: Write the failing source-boundary regression test**

Add a test named `picker recovery persists and releases only the granted read URI permission` that reads `FileMediaPlugin.kt`, asserts `takePersistableUriPermission` occurs before `markPickerImporting`, and asserts a matching `releasePersistableUriPermission` is reached from picker import finalization.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec tsx --test tests/android-plugin-boundary.test.ts`

Expected before implementation: the new assertion fails because `takePersistableUriPermission` is absent.

- [x] **Step 3: Implement the smallest native grant lifecycle**

Before persisting picker `sourceUri`, request `Intent.FLAG_GRANT_READ_URI_PERMISSION` using `contentResolver.takePersistableUriPermission`. If the system cannot provide a durable read grant, finish the operation with the existing safe `ERR_MEDIA_READ_FAILED` code rather than persisting an import that cannot be recovered. In the picker import `finally` path, safely release that same read grant after the private copy has either succeeded or reached a terminal failure.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm exec tsx --test tests/android-plugin-boundary.test.ts`

Expected: the new test and existing boundary tests pass.

### Task 3: Reproduce and clean an abandoned camera staging file

**Files:**
- Modify: `tests/android-plugin-boundary.test.ts`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`
- Test: `android/app/src/test/java/com/hongtai/aiagent/media/PhotoOperationStateStoreTest.kt`

- [x] **Step 1: Write the failing lost-result cleanup assertion**

Add a test named `lost camera callbacks discard the constrained staging capture before terminal recovery failure`. It must assert that the `handleOnResume` path restores only the stored capture leaf name and calls `discardCapture` before `PHOTO_RECOVERY_FAILED` is persisted.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec tsx --test tests/android-plugin-boundary.test.ts`

Expected before implementation: the cleanup assertion fails because `handleOnResume` only calls `finishFailure`.

- [x] **Step 3: Implement the constrained cleanup**

When the persisted awaiting state is a capture, call `restorePhotoCapture(awaiting.captureFileName)` and `discardCapture` only if the constrained file exists, then finish with `ERR_PHOTO_RECOVERY_FAILED`. Never touch imported media or an arbitrary path.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm exec tsx --test tests/android-plugin-boundary.test.ts`

Expected: the cleanup assertion and current capture-boundary assertions pass.

### Task 4: Integrate #1–#4 on main and resolve contracts as a union

**Files:**
- Modify: all files in `e17d5f4^..photo-fix-head`, `63ca239^..3fe7a34`, and `bfdf772`.

- [x] **Step 1: Cherry-pick the finalized photo range**

Run: `git cherry-pick e17d5f4e03612f41f6b44a293a695b30418bb1db^..photo-fix-head`

Expected: photo I/O, recovery state, tests and evidence are present on `main`.

- [x] **Step 2: Cherry-pick the link-diagnostic commits in order**

Run: `git cherry-pick 63ca239c0f2fd16759334cd763c25a35486446a8^..3fe7a3447d9cf9dd3858d3637f226c6138a4d305`

Expected: Android safe diagnostics, core mapping, UI notice, contract documentation and visual evidence are present.

- [x] **Step 3: Cherry-pick the normal-upgrade commit**

Run: `git cherry-pick bfdf772e2ba8086b789123504d90bfa493c22169`

Expected: `versionCode = 3` and its v2→v3 QA regression assertion are present.

- [x] **Step 4: Resolve any overlap by retaining both behavior sets**

For `NativeIssueCode.kt`, `models.ts`, and `android-plugin-boundary.test.ts`, retain photo, link and upgrade additions. Validate with `git diff --check` before continuing.

### Task 5: Update live records and verify the integrated APK

**Files:**
- Modify: `docs/错误码与前端通知约定.md`
- Modify: `docs/当前能力与发布状态.md`
- Create: `docs/验收/2026-08-09-p0-main-integration.md`

- [x] **Step 1: Update only current facts**

Record the stable image cancellation/recovery and link-diagnostic contracts; state versionCode 3 and emulator QA upgrade evidence; keep physical-device and formal release-signing status explicitly unverified.

- [x] **Step 2: Run combined gates**

Run: `pnpm check`; `pnpm --filter @hongtai/web build`; `android/gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon --console=plain`.

Expected: report exact pass/fail output. If remaining lint is a pre-existing `@UnstableApi` declaration, fix it only as a separately scoped minimal Android compatibility commit and rerun lint.

- [x] **Step 3: Run available device evidence and package checks**

Use the connected emulator only if it is idle. Verify the final debug APK manifest/version, SHA-256, and an ordinary `adb install -r` upgrade from a same-signature v2 fixture when available. Do not claim physical-device validation without a connected physical device.

Actual: the connected emulator was not idle, so this integration used only read-only package inspection and did not overwrite its running QA state. The prior same-signature v2→v3 normal-upgrade evidence remains linked from the acceptance record.

- [x] **Step 4: UTF-8, sensitive-data, and staged-diff checks**

Run strict UTF-8/U+FFFD scanning for changed text, inspect sensitive-data patterns without printing secrets, and run `git diff --cached --check` before each commit.

- [x] **Step 5: Commit completed phases precisely**

Commit the recovery gap repair, integrated candidate commits, and current-documentation evidence with exact path staging. Do not use `git add .`, push, close Issues, delete branches, or delete worktrees.
