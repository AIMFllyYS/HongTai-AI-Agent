# P0 主分支集成验收记录（#1–#4）

日期：2026-08-09
分支：`main`
集成基线：`8d20ad9f657fd57baab0506ff86b2dcfc6a7fece`

## 范围与合并结果

本次在主分支顺序整合了三个独立交付范围：

1. Issue #1/#2：`e17d5f4^..40e036d` 的外部照片 Activity 恢复、后台私有导入、UI 终态与 API 24 兼容实现；
2. Issue #3：`63ca239^..3fe7a34` 的安全链接失败分类、Capacitor/core DTO 映射与通知展示；
3. Issue #4：`bfdf772` 的 `versionCode = 3` 与同 Debug 签名普通升级回归。

三条候选均以同一基线产生。`NativeIssueCode.kt`、`packages/core/src/models.ts` 与 `tests/android-plugin-boundary.test.ts` 出现重叠时，Git 三方合并未产生冲突；集成后逐项核对，照片恢复码、全部 `ERR_LINK_*`、`NativeLinkDiagnosticV1` 与 v3 升级断言均同时保留。

## 集成期间补齐的最小修复

### 照片 picker 的进程重建读取授权

`PhotoOperationStateStore` 会在应用重建后恢复处于 `importing` 的 picker 操作。仅保存 `content://` URI 不能保证应用停止后仍有读取权限，因此 `FileMediaPlugin` 现在在持久化该 URI 前请求 `FLAG_GRANT_READ_URI_PERMISSION` 的持久化授权；私有复制到终态后释放授权。若授权后无法写入 `importing` 状态，也会立即释放授权再进入安全失败路径。不能获得该授权时，操作以安全的 `ERR_MEDIA_READ_FAILED` 终止，而不会持久化一个注定不可恢复的导入。

### 丢失相机回调时的 staging 清理

外部相机返回而回调丢失时，恢复路径在写入 `ERR_PHOTO_RECOVERY_FAILED` 前，仅按已校验的 capture leaf name 恢复并删除 cache staging 文件。它不会触碰任何已导入的私有媒体。

### Android lint 的 Media3 调用边界

`MainActivity.onCreate` 注册 `ProductionRuntimePlugin` 的调用点现在直接标注 `@UnstableApi`。此前使用 Kotlin `@OptIn` 的尝试不适用于该 AndroidX 注解；最终实现以 lint 要求的注解形式限定在唯一调用方法，不创建全局 lint baseline 或关闭规则。

## 自动验证

| 验证 | 结果 |
| --- | --- |
| `pnpm exec tsx --test tests/android-plugin-boundary.test.ts` | 12/12 通过；其中新增 picker 授权、丢失相机回调清理、Media3 注册边界回归 |
| `pnpm check` | 通过：TypeScript、ESLint、根测试共 189/189 |
| `pnpm --filter @hongtai/web build` | 通过，611 modules；保留既有单一 JS chunk 大于 500 kB 的警告 |
| `:app:testDebugUnitTest` | 通过，使用 JDK 21 与本机 Android SDK |
| `:app:lintDebug` | 通过，无 error；仍有 23 个现存 warning，未通过 baseline 隐藏 |
| `:app:assembleDebug` | 通过 |
| `git diff --check` | 集成范围与本次修复范围均通过 |

最终 Debug APK：

- 路径：`android/app/build/outputs/apk/debug/app-debug.apk`
- package：`com.hongtai.aiagent`
- `versionCode`：`3`
- `versionName`：`0.0.1`
- SHA-256：`F052F29ED5E21D06272D4247C638BE2F41BB61F4A5F3255860649276A97FDEAE`
- 签名：Android Debug 证书；APK Signature Scheme v2 验证通过。

## 模拟器与发布边界

- API 35 模拟器 `emulator-5554` 已连接；只读检查确认它当前已有一个正在前台运行的 `com.hongtai.aiagent` v3 安装，因此本次没有覆盖安装、强制停止、降级或清空其数据。
- [P0 Issue #4 验收记录](2026-08-09-p0-normal-upgrade.md) 已保存同 Debug 证书 v2→v3、未带 `-d` 的普通升级和受控私有样本保留证据；它是历史 v2 基线的真实 PackageManager 证据，不等同于本次最终 APK 的重复升级执行。
- 本次没有执行物理 Android 真机、OEM 相机、Photo Picker 进程回收、真实 DNS/TLS/切网或链接通知 E2E；不得据此声明真机通过。
- 当前 APK 仍是 Debug/QA 包。团队 release keystore、非 Debug 签名和正式分发升级兼容性继续由 Issue #5 阻断。

## 后续验收入口

- 照片真机/Activity 生命周期：见 [P0 照片可靠性验收记录](2026-08-09-p0-photo-reliability.md) 的独立模拟器和物理设备步骤。
- 链接网络真实 E2E：见 [P0 Issue #3 验收](2026-08-09-p0-link-diagnostics.md) 的受控网络与物理网络矩阵。
- 正式签名：见 Issue #5；未取得团队签名材料前不得以本 Debug APK 替代正式 release。
