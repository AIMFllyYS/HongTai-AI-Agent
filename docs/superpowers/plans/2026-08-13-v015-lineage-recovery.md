# v0.1.5 Lineage Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不丢失 `fix/issue05-issue07` 严重问题修复、`feat/video-workflow-management` 视频工作流能力和 `main` 最新生命周期修复的前提下，恢复单一、可验证、可发布的 v0.1.5 代码谱系。

**Architecture:** 以当前 `main` 为基线，在隔离救援分支中先恢复底层 Android 兼容性与 Release 工程，再恢复视频工作流；所有冲突按“语义并集”解决，不按文件整侧覆盖。共享状态机继续位于 TypeScript 共享层，Kotlin 只承担 Android I/O；版本、签名、升级路径与真机结果分别验证。只有所有适用门禁通过后，救援分支才允许回合并 `main`。

**Tech Stack:** pnpm workspace、TypeScript、React、Capacitor、Kotlin/Gradle、Node.js test runner、Android SDK/JDK 21、adb/apksigner/aapt。

---

## 任务契约

- **允许范围：** 分支谱系恢复、冲突语义合并、相关回归测试、v0.1.5/versionCode 12 版本契约、Release 构建与验收记录。
- **非目标：** 不新增云端后台、账号体系、泛化后台常驻服务；不发布 APK、不推送远端、不覆盖现有公开下载地址；不处理无关工作区文件。
- **权威状态源：** 任务状态由 `RuntimeOperationRegistry` 与各领域服务的持久状态共同约束；Android Activity 生命周期只触发恢复检查，不成为业务状态权威源。
- **合并目标：** `rescue/v0.1.5-lineage-recovery`。在真机与 Release 门禁未满足时，不回合并 `main`。
- **回滚边界：** `backup/20260813-main-before-lineage-rescue`、`backup/20260813-issue05-07-source`、`backup/20260813-v014-source` 三个本地引用必须保留。

## Task 1：冻结证据与隔离执行环境

**Files:**

- Create: `docs/superpowers/plans/2026-08-13-v015-lineage-recovery.md`
- Inspect: `docs/当前能力与发布状态.md`
- Inspect: `docs/架构与工程规范.md`
- Inspect: `docs/任务执行模板.md`

- [x] 记录 `main`、问题修复分支、视频工作流分支的精确提交与分叉关系。
- [x] 创建三个不可变本地备份引用。
- [x] 从当前 `main` 创建 `rescue/v0.1.5-lineage-recovery` 隔离工作树。
- [x] 执行 `pnpm install --frozen-lockfile`。
- [x] 执行合并前 `pnpm test`，确认 197 项基线测试通过。
- [x] 精确暂存并提交本计划：

```powershell
git add -- docs/superpowers/plans/2026-08-13-v015-lineage-recovery.md
git commit -m "docs(plan): stage v0.1.5 lineage recovery"
```

## Task 2：先恢复 Issue 05/07、Android 兼容性与 Release 工程

**Files:**

- Modify: `capacitor.config.ts`
- Modify: `android/app/src/main/assets/capacitor.config.json`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.test.ts`
- Modify: `docs/当前能力与发布状态.md`
- Test: `tests/android-release-signing-contract.test.ts`
- Test: `tests/android-plugin-boundary.test.ts`
- Test: `tests/android-webview-compat.test.ts`
- Test: `tests/android-heif-native-boundary.test.ts`

- [x] 以非快进、停止在提交前的方式合入修复分支：

```powershell
git merge --no-ff --no-commit fix/issue05-issue07
```

- [x] 逐个审计冲突，保留以下语义并集：

```ts
android: {
  minWebViewVersion: 89,
  minHuaweiWebViewVersion: 10,
  includePlugins: ["@capacitor/app"],
}
```

- [x] 分析与诊察服务同时保留结构化流事件回调、`RuntimeOperationRegistry` 跟踪和未完成工作恢复。
- [x] 生产服务测试同时保留恢复验证与现有生产流程验证，不删除任一侧覆盖面。
- [x] 运行 Android Release/插件/WebView/HEIF 定向契约测试及 `@hongtai/capacitor-runtime` 测试。
- [x] 运行 `pnpm check`，确认类型与架构边界通过。
- [x] 精确暂存冲突文件并提交合并：

```powershell
git commit -m "merge: restore release and compatibility baseline"
```

## Task 3：恢复视频工作流并形成三方语义并集

**Files:**

- Modify: `packages/capacitor-runtime/src/app-runtime.ts`
- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.ts`
- Modify: `packages/capacitor-runtime/src/standalone-task-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/TaskHomePage.tsx`
- Modify: `apps/web/src/pages/TaskAnalysisPage.tsx`
- Modify: `docs/当前能力与发布状态.md`
- Test: adjacent `*.test.ts` files in the same packages

- [x] 以非快进、停止在提交前的方式合入视频工作流分支：

```powershell
git merge --no-ff --no-commit feat/video-workflow-management
```

- [x] `AppRuntime` 同时暴露生命周期恢复能力与视频模板能力：

```ts
export interface AppRuntime {
  recovery: RuntimeRecoveryService;
  templates: VideoTemplateService;
}
```

- [x] `StandaloneAppRuntime` 同时构造并返回两类服务，禁止以整侧文件覆盖丢失依赖。
- [x] `StandaloneTaskService` 同时保留本地视频 Pipeline 请求、operation registry 跟踪，以及运行中/排队中本地视频任务的异常恢复。
- [x] 分析与诊察服务同时保留结构化流式事件和生命周期恢复。
- [x] 生产服务同时保留项目级互斥、operation registry、取消/删除和异常恢复。
- [x] Web 同时保留新增路由、模板/视频入口与 `useAppResume` 恢复触发。
- [x] 先运行定向测试观察红灯，再只修复语义并集缺口，直至定向测试通过。
- [x] 运行 `pnpm test` 与 `pnpm check`，然后提交三方合并：

```powershell
git commit -m "merge: integrate video workflow with lifecycle recovery"
```

## Task 4：用回归测试锁定跨分支交互契约

**Files:**

- Modify: `packages/capacitor-runtime/src/standalone-app-runtime.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-task-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-analysis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.test.ts`
- Modify: `packages/capacitor-runtime/src/standalone-production-service.test.ts`
- Modify: `tests/android-plugin-boundary.test.ts`

- [x] 新增一个最小契约测试，证明运行时必须同时提供 `recovery` 与 `templates`。
- [x] 新增一个最小失败测试，证明本地视频任务进入后台恢复登记且被中断后不会永久保持“进行中”。
- [x] 新增一个最小交互测试，证明生产项目互斥不会绕过 operation registry。
- [x] 新增配置契约，证明 WebView 下限与 `@capacitor/app` 白名单同时存在。
- [x] 对每个失败测试确认失败原因正确，再做最小实现使其转绿。
- [x] 运行相关包测试、`pnpm test`、`pnpm check`。
- [x] 精确提交：

```powershell
git commit -m "test(runtime): lock merged lifecycle and video contracts"
```

## Task 5：建立真实的 v0.1.5/versionCode 12 发布身份

**Files:**

- Modify: `android/app/build.gradle.kts`
- Modify: `scripts/build-android-release.ps1`
- Modify: `tests/android-version-lineage.test.ts`
- Modify: `tests/android-plugin-boundary.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/当前能力与发布状态.md`
- Modify: `download.html`
- Modify: `tests/android-webview-compat.test.ts`
- Create: `docs/验收/2026-08-13-v015-lineage-recovery.md`

- [x] 先将版本谱系测试更新为 `versionName 0.1.5`、`versionCode 12`，确认旧配置下测试失败。
- [x] 更新 Gradle 与 Release 构建脚本，使源配置、脚本断言和产物身份一致。
- [x] 更新活文档：明确公开的同名 v0.1.5 debug 文件身份错误、不得作为升级包；不得伪造新 Release 下载地址或哈希。
- [x] 下载页继续以已验证事实为准；错误身份的同名文件标记为已撤回/不可升级，正式候选未发布前不得升为顶部推荐。
- [x] 验收记录分别列出代码合并、自动测试、模拟器、真机、签名、升级路径和发布状态，未验证项必须明确标为未验证。
- [x] 运行版本谱系及下载页定向测试、Web build、UTF-8/U+FFFD 扫描。
- [ ] 精确提交：

```powershell
git commit -m "chore(release): prepare truthful v0.1.5 identity"
```

## Task 6：完整自动化与 Release 产物门禁

**Files:**

- Verify: entire workspace
- Generate: `android/app/build/outputs/apk/debug/app-debug.apk`
- Generate: `android/app/build/outputs/apk/release/app-release.apk`

- [x] 从已提交可执行源码执行 `pnpm test`：245/245 通过。
- [x] 执行 `pnpm check`：TypeScript、ESLint 与 245/245 测试通过。
- [x] 执行 `pnpm --filter @hongtai/web build`：626 modules transformed。
- [x] 执行相关 Gradle unit test、lint、debug assemble：Debug/Release JVM 各 70/70，lint 各 0 error，Debug 和 androidTest APK 构建成功。
- [x] 使用仓库 Release 脚本构建正式签名 APK；未读取或打印 keystore 密码/私钥内容。
- [x] 使用 `aapt` 验证包内真实身份是 0.1.5/12、包名正确、四 ABI 完整。
- [x] 使用 `apksigner verify --verbose --print-certs` 验证 Release APK 非 debuggable、v2/v3 有效，并记录公开证书 SHA-256。
- [x] 计算候选 APK SHA-256 和字节数；端测后的最终重建哈希保持 `48D658...E6D`。
- [x] 最终文档提交前检查 `git diff --check`、未解决冲突标记、文本 U+FFFD、tracked secrets 和精确工作区状态；两个 U+FFFD grep 命中仅来自既有 PNG 二进制字节，不是文本编码损坏。

## Task 7：端侧验收与升级谱系判定

**Files:**

- Update: `docs/验收/2026-08-13-v015-lineage-recovery.md`

- [x] 执行 `adb devices -l`：唯一设备为 API 35 x86_64 AVD，`ro.kernel.qemu=1`；没有物理设备。
- [x] Debug 谱系：从当前公开 v0.1.4/code11 Debug 正常覆盖到 code12 Debug，用于迁移期 QA。
- [x] Release 谱系：以相同正式证书的 v3 Release 基线验证到 v0.1.5/code12，无卸载、无 `-d`，升级成功并保持 `firstInstallTime`；同时记录公开 Debug→Release 被签名规则拒绝。
- [ ] 验证最小化/切换应用后流程继续或恢复为明确终态，页面不永久显示“正在执行中”。
- [ ] 验证相机/系统照片选择器路径与设置页权限表现；不新增宽泛媒体权限来掩盖问题。
- [ ] 验证本地视频导入、分析、诊察、生产、取消、恢复与关键输出。
- [x] 将设备型号、Android 版本、输入产物哈希、安装命令结果和失败证据写入验收记录。
- [x] 物理设备不可用；保留救援分支，禁止回合并 `main`，并明确签名迁移与物理端侧剩余阻塞。

当前模拟器已通过 Home 往返、受控进程重建、相机/Photo Picker/MP4 Picker 打开和取消、Media3 instrumentation；上面三项仍保持未勾选，是因为没有物理真机、有效 AI Key 与真实媒体，尚不能把部分烟测写成完整端侧 E2E。

## Task 8：受门禁保护地回合并 main

- [ ] 确认救援分支状态干净、所有提交可追溯、自动化和要求的物理设备门禁全部通过。
- [ ] 在原 `main` 工作树确认只有任务前已存在的无关文件，且不会被合并覆盖。
- [ ] 创建回合并提交：

```powershell
git merge --no-ff rescue/v0.1.5-lineage-recovery -m "merge: recover v0.1.5 release lineage"
```

- [ ] 在 `main` 上重新执行 `pnpm test`、`pnpm check`、Web build 和关键 Android/Release 身份验证。
- [ ] 最终报告提交图、保留的安全引用、测试结果、APK 绝对路径、字节数、SHA-256、真实版本/签名身份以及未执行的端侧项。
- [ ] 未经用户明确授权，不推送远端、不上传 APK、不改线上下载链接、不删除救援工作树或备份引用。
