# P0 Issue #4：Debug/QA 同签名正常升级验收

> 本文只记录 API 35 模拟器上的 Debug/QA 同签名谱系。它不是物理真机证据，也不是正式 release signing 证据；GitHub Issue #5 的团队 release 签名链仍未完成。

日期：2026-08-09

## 任务契约

- 目标：修复 `versionCode` 从历史最高值 2 回退到 1 的问题，并验证同 Debug 签名的 v2 基线能够通过不带 `-d` 的普通更新安装升级到 v3。
- 允许修改：`android/app/build.gradle.kts`、对应边界测试和本文。
- 明确不做：不修改 `signingConfig`，不生成 keystore，不处理 Issue #1、#2、#3、#5 或其他 Issue，不把 Debug 包称为正式 release。
- 状态权威来源：APK 中的 manifest 元数据、`apksigner` 证书摘要、Android PackageManager 包信息，以及应用私有样本文件的 SHA-256。

## 环境边界

- ADB：`C:\Users\AIMFl\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- 模拟器：`emulator-5554`，AVD `SciChatApi35`，API 35，启动状态完成。
- 执行前 `adb devices -l` 只列出这一台模拟器；本次所有 ADB 命令均显式使用 `-s emulator-5554`。
- 这是模拟器 PackageManager 的真实安装证据，不是物理真机验收。

## 历史 v2 基线

- 原主工作区 APK：`D:\projects\Dev-Tools\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk`
- 工作树外保护副本：`C:\Users\AIMFl\AppData\Local\Temp\HongTai-P0-Issue4-20260809-052500\app-debug-v2-0.2.0.apk`
- 原件和保护副本 SHA-256：`AA6E9705044C1A15F3D0E42FAD68EA6AC450815132C629692100818F6DCC83B0`
- package：`com.hongtai.aiagent`
- versionCode：`2`
- versionName：`0.2.0`
- 签名主体：`C=US, O=Android, CN=Android Debug`
- 签名证书 SHA-256：`b9d31f9089bf70b5fb487200021a3a35f1001e9b32c8dddf7aa0d8c0bdc66bd8`
- `apksigner verify --verbose --print-certs`：v2 签名通过；v1、v3、v3.1 和 v4 未使用。

保护副本通过 `Copy-Item` 新建，复制后重新计算 SHA-256 并与原件比对一致；原 APK 未被覆盖。

## v3 Debug 候选 APK

- APK：`C:\Users\AIMFl\.codex\worktrees\d583\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk`
- SHA-256：`0789C88E8689DFEEDAE66DC9F07EEF64C554318347B403DF18453E70087E14B2`
- package：`com.hongtai.aiagent`
- versionCode：`3`
- versionName：`0.0.1`
- 签名主体：`C=US, O=Android, CN=Android Debug`
- 签名证书 SHA-256：`b9d31f9089bf70b5fb487200021a3a35f1001e9b32c8dddf7aa0d8c0bdc66bd8`
- `apksigner verify --verbose --print-certs`：v2 签名通过；v1、v3、v3.1 和 v4 未使用。

旧、新 APK 的 package 与签名证书 SHA-256 完全一致；只有这个 Debug/QA 谱系具备本次升级证据。

## 不带降级参数的正常升级

先安装受保护的 v2 基线，在 `files/issue4-normal-upgrade-sample.txt` 创建固定、无个人信息的应用私有样本。升级前样本为 39 字节，SHA-256 为：

`07f487d6e9ea50fdce861dd5f6950b568054e974303fe38decda91f8fae5aa7e`

实际升级命令如下，未使用 `-d`：

```powershell
& 'C:\Users\AIMFl\AppData\Local\Android\Sdk\platform-tools\adb.exe' `
  -s emulator-5554 install -r `
  'C:\Users\AIMFl\.codex\worktrees\d583\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk'
```

结果：

- 安装器输出：`Performing Streamed Install`、`Success`。
- 升级前 PackageManager：`versionCode=2`、`versionName=0.2.0`。
- 升级后 PackageManager：`versionCode=3`、`versionName=0.0.1`。
- `firstInstallTime` 在升级前后保持不变，`lastUpdateTime` 更新。
- `am force-stop` 后启动 `com.hongtai.aiagent/.MainActivity`：`Status: ok`、`LaunchState: COLD`、`Activity: com.hongtai.aiagent/.MainActivity`，并获得运行中进程 PID。
- 升级后私有样本仍为 39 字节，SHA-256 仍为 `07f487d6e9ea50fdce861dd5f6950b568054e974303fe38decda91f8fae5aa7e`。

因此，本次验证证明 API 35 模拟器中的同 Debug 签名 v2 基线可以通过 Android PackageManager 的普通更新路径升级到 v3，并保留受控应用私有数据。

## 构建与测试

- `pnpm exec tsx --test tests/android-plugin-boundary.test.ts`：7/7 通过；修复前该测试按预期捕获 `versionCode=1` 不满足 3。
- `pnpm check`：类型检查、ESLint 和 178/178 根测试通过。
- `:app:testDebugUnitTest`：通过。
- `:app:assembleDebug`：通过。
- `:app:lintDebug`：已运行，现有代码报告 2 个错误和 22 个警告；两个错误分别位于 `PrivateMediaStore.kt:68` 的 API 33 `readNBytes` 调用和 `MainActivity.kt:27` 的 Media3 opt-in。它们不在本次差异中，本任务按 Issue #4 范围未修改这些文件，也不以 lint 通过作为虚假结论。

## 签名结论

本次只证明历史 v2 与候选 v3 使用同一个 Android Debug 证书时的 QA 侧载升级兼容性。仓库仍未建立受控、可复现、非 Debug 的正式 release 签名配置；Issue #5 仍需独立完成，不能由本证据推导未来正式 release 的升级兼容性。
