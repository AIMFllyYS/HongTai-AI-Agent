# Debug APK 验收记录

验收日期：2026-08-07

## 构建产物

- 类型：debug APK（不作为 release 包）
- 应用 ID：`com.hongtai.aiagent`
- 版本：`0.1.0`（versionCode 1）
- 产物路径：`C:\Users\AIMFl\.codex\worktrees\aec9\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk`
- 文件大小：36,802,961 bytes
- SHA-256：`F90CEC609727C85FCBA260F0C521F6AB98D7E42FF344FCB0793447532CDBF2EF`

## 自动门禁

- `pnpm check`：通过（165 项测试通过）
- `pnpm --filter @hongtai/capacitor-runtime test`：通过（20 项测试通过）
- `pnpm --filter @hongtai/web build`：通过
- `:app:testDebugUnitTest`：通过（Android Studio JBR 21）
- `:app:assembleDebug`：通过（Android Studio JBR 21）
- UTF-8 替换字符扫描：未发现 `U+FFFD`
- APK Web 资源扫描：未发现 `.env` 文件；未发现 API Key
- `git diff --check`：通过

## 模拟器实测

- 设备：Android SDK 模拟器 `sdk_gphone64_x86_64`
- Android：15
- API：35
- 安装：`adb install -r` 成功
- 冷启动：成功，主 Activity 为 `com.hongtai.aiagent/.MainActivity`
- 系统图片选择器：成功进入系统 Photo Picker
- 系统相机：成功进入 `com.android.camera2/.CaptureActivity`
- 拍照返回：成功，拍摄结果返回应用并显示预览，观察报告按钮被启用
- 稳定性：应用主进程未崩溃；自动化反复切换页面期间日志出现一次 WebView renderer 重启，页面自行恢复，另有 Chromium 页面绘制指标提示

## 尚未声称通过的项目

- 未连接物理设备，因此不声称物理真机验收通过。
- 未通过 ADB 注入 `.env` 或 API Key；模拟器中未执行真实 AI 文本、视觉、ASR 探测。
- 未在模拟器中执行真实平台采集、内容拆解、观察报告和报告追问。
- Fake-IP 兼容由 Kotlin 单元测试覆盖，本次模拟器网络不具备同一代理环境，因此不声称已完成代理环境实测。

以上未完成项不影响 APK 的构建、安装、启动、系统图片选择器和系统相机桥接结论；真实业务验收需在设置页手工录入对应配置后继续执行。
