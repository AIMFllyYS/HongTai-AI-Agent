# P0 照片可靠性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复系统相册/外部相机在 Activity 或进程重建后的可解释恢复，并将照片私有化与规范化导入移出 Android 主线程，最终只向 React 暴露安全 DTO。

**Architecture:** Android 用一个小型持久化状态类记录单个照片操作的最小短生命周期状态；`FileMediaPlugin` 只负责 Activity 编排、恢复消费和把重 I/O 投递到单线程 executor，`PrivateMediaStore` 继续拥有既有原子复制与 JPEG 归一化规则。Capacitor Runtime 把原生恢复终态映射为 `MediaReference` 或稳定 `TaskIssue`，React 页面用独立 `importing` 状态覆盖选择、拍摄、取消和失败终态。

**Tech Stack:** Kotlin、Android Activity Result、Capacitor 8、TypeScript、React 19、Node test、Gradle/JUnit/Android instrumentation。

---

## 任务契约

## 目标

- 用户可感知的结果：选择或拍摄图片后立即看到导入中；正常、取消、缺失 URI、丢失 capture、读取失败、超限、无效图片和导入失败都进入明确终态。

## 允许修改

- Android I/O：`FileMediaPlugin.kt`、`PrivateMediaStore.kt`、照片操作状态类及对应测试。
- Capacitor Runtime：`standalone-bridge.ts`、`standalone-diagnosis-service.ts` 及对应测试。
- UI：`ObservationStartPage.tsx` 及观察页面定向测试。
- 共享契约：仅为照片恢复所需的最小 DTO/稳定错误码。
- 文档：本计划、错误码配套文档和唯一验收记录。

## 明确不做

- 不修改 README、当前能力与发布状态、架构与工程规范。
- 不处理 Issue #3/#4 及之后 Issue，不新增权限、云端后端、后台服务或通用任务框架。
- 不操作共享模拟器，不 push，不关闭 Issue。

## 架构归属

- Android I/O 保存系统照片操作状态并执行私有文件 I/O；Kotlin 不决定诊察业务文案、Prompt 或 Schema。
- Capacitor Runtime 是原生结果到 `AppRuntime` 安全 DTO 的唯一映射边界。
- React 只调用 `runtime.diagnosis`，不读取原生插件、`content://`、`file://` 或私有路径。

## 权威状态与数据

- 每次照片操作只有一个 `operationId` 和一个持久化权威状态。
- 原始 WebView Promise 丢失后不再 resolve 它；重建页面通过新的恢复消费调用读取一次性终态。
- 成功或失败只能首次写入；消费后清理。相机只持久化受约束的 capture 叶文件名，不保存图片内容或 base64。

## 验收

- 定向测试：照片状态 JVM 测试、PrivateMediaStore JVM/instrumentation、Capacitor diagnosis 测试、Web observation 测试。
- 构建/lint：`pnpm check`、Web build、Gradle JVM 测试、lint、debug APK。
- 真机证据：本 worktree 不操作设备；验收记录列出最终集成必须执行的相册/相机/进程回收步骤。
- 用户实际会看到：导入中、成功预览、取消提示或按稳定问题动作给出的重试提示，不再无反馈或永久忙碌。

---

### Task 1: 可恢复照片操作状态契约

**Files:**

- Create: `android/app/src/main/java/com/hongtai/aiagent/media/PhotoOperationStateStore.kt`
- Create: `android/app/src/test/java/com/hongtai/aiagent/media/PhotoOperationStateStoreTest.kt`

- [ ] 写正常、取消、缺失 URI、丢失 capture、单一终态、消费清理的失败 JVM 测试。
- [ ] 运行 `android/gradlew.bat :app:testDebugUnitTest --tests com.hongtai.aiagent.media.PhotoOperationStateStoreTest`，确认因契约不存在而失败。
- [ ] 实现仅保存操作类型、阶段、受约束 capture 文件名、必要 URI、稳定终态元数据的状态类。
- [ ] 重跑定向 JVM 测试并通过。
- [ ] 精确暂存、`git diff --cached --check`、UTF-8 扫描并提交。

### Task 2: Activity 恢复编排与后台导入

**Files:**

- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/FileMediaPlugin.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/bridge/NativeIssueCode.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/media/PrivateMediaStore.kt`
- Modify: `android/app/src/main/java/com/hongtai/aiagent/media/PhotoCapturePolicy.kt`
- Modify: `android/app/src/test/java/com/hongtai/aiagent/media/PhotoCapturePolicyTest.kt`
- Modify: `android/app/src/androidTest/java/com/hongtai/aiagent/media/PrivateMediaStoreInstrumentationTest.kt`
- Modify: `tests/android-plugin-boundary.test.ts`

- [ ] 先补 capture 恢复、Activity 回调轻量化、后台 executor 和真实图片/临时文件清理的失败测试。
- [ ] 分别运行 Node/Gradle 定向测试，确认缺少恢复与 executor 行为而失败。
- [ ] 让回调只记录结果并投递后台导入；进程重建后从状态恢复 picker URI 或 capture 叶文件名。
- [ ] 正常调用只完成当前 Promise；dangling/null 调用保留一次性恢复终态，供新 WebView 消费。
- [ ] 重跑定向测试并提交。

### Task 3: Capacitor Runtime 安全恢复映射

**Files:**

- Modify: `packages/core/src/application-runtime.ts`
- Modify: `packages/core/src/models.ts`
- Modify: `packages/capacitor-runtime/src/standalone-bridge.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.ts`
- Modify: `packages/capacitor-runtime/src/standalone-diagnosis-service.test.ts`
- Modify: `docs/错误码与前端通知约定.md`

- [ ] 先写成功恢复不暴露私有 URI，以及取消、缺失 URI、丢失 capture、读取失败、导入失败映射的失败测试。
- [ ] 运行 Capacitor Runtime 定向测试并确认失败。
- [ ] 增加一次性 `consumeImageRecovery` DTO；成功走现有 `MediaReference` 映射，失败只返回稳定 `TaskIssue`。
- [ ] 重跑定向测试、类型检查并提交。

### Task 4: React 独立 importing 状态

**Files:**

- Modify: `apps/web/src/pages/ObservationStartPage.tsx`
- Modify: `tests/web-observation-runtime.test.ts`

- [ ] 先写选择/拍摄开始即 importing，成功/取消/超限/无效/恢复失败都清理 busy 的失败测试。
- [ ] 运行 Web observation 定向测试并确认失败。
- [ ] 使用独立 `importing` 状态禁用照片操作并显示“正在导入图片”；报告生成继续使用原有 `loading`。
- [ ] 页面启动消费一次恢复状态，成功设置图片，失败设置 `TaskIssue`，所有路径在 `finally` 结束 importing。
- [ ] 重跑定向测试、`pnpm check`、Web build 并提交。

### Task 5: 验收记录与完整验证

**Files:**

- Create: `docs/验收/2026-08-09-p0-photo-reliability.md`

- [ ] 记录根因、状态契约、已验证命令、不得声称的真机范围和安全素材要求。
- [ ] 运行完整 `pnpm check`、Web build、相关 Gradle JVM 测试、lint、debug build。
- [ ] 扫描 U+FFFD、敏感字段、base64/私有路径泄露并执行 `git diff --check`。
- [ ] 精确暂存验收记录并提交；输出本分支 commit hash 列表和最终集成端测步骤。
