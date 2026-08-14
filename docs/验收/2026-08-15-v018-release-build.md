# v0.1.8 Release APK 构建验收

> 日期：2026-08-15。本文按构建阶段持续补充，只记录已经取得的证据。

## 目标

- 将 Android 源码候选从 `0.1.7` / `versionCode=15` 单调递增到 `0.1.8` / `versionCode=16`。
- 使用仓库唯一 Release 构建入口生成、验签并归档 `HongTai-AI-Agent-release-v0.1.8.apk`。
- 将本地视频拆解修复和用户化界面文案归档到 v0.1.8 更新日志。

## 允许修改

- Android 唯一版本源、版本契约测试、README、版本流程、CHANGELOG、当前状态和本验收记录。
- 构建脚本正常生成的 Web/Capacitor/Gradle 产物与版本化 APK 归档。

## 明确不做

- 不修改业务架构、AI Flow、平台解析、权限或签名身份。
- 不构建、交付或归档 Debug APK。
- 不提前把 `download.html` 改为尚未完成公开上传和公网哈希回验的 v0.1.8。
- 不推送远端，不改动或暂存用户文件 `HongTai.zip`。

## 架构归属与权威状态

- `android/app/build.gradle.kts` 是 `versionName` 与 `versionCode` 的唯一源码权威。
- `scripts/build-android-release.ps1` 是唯一 APK 构建入口；它负责 Web build、Capacitor sync、Release 单测、lint、四 ABI 构建、包身份、证书、v2/v3、16 KiB zipalign 和 SHA-256 后验。
- `output/apk-archive/HongTai-AI-Agent-release-v0.1.8.apk` 是构建成功后的唯一版本化交付文件；历史 APK 不覆盖。

## 验收计划

- 定向版本与归档测试。
- `pnpm check` 与 Web production build。
- Release JVM 测试、`lintRelease`、`assembleRelease`。
- `aapt2` 包身份、`zipalign`、`apksigner`、证书锚点、APK 大小和 SHA-256。
- 检查是否存在可用于正常覆盖安装的 Android 设备；没有设备时明确保留真机门禁。

## 当前状态

- 源码版本与包内身份：`0.1.8` / `versionCode=16`。
- 精确构建来源提交：`ccc7031d5ead8c43616bb091861c8370b3bafb1f`。
- Release APK：[HongTai-AI-Agent-release-v0.1.8.apk](../../output/apk-archive/HongTai-AI-Agent-release-v0.1.8.apk)。
- 文件大小：25,955,845 字节。
- APK SHA-256：`92CF32EE71174FA6941FBD6B765EE5BB1FE8C6DC87F24BD59ED967E05B9CAB17`。
- 包名：`com.hongtai.aiagent`；`minSdk=24`、`targetSdk=36`。
- 签名证书：`CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN`。
- 证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。
- APK Signature Scheme v2/v3：均为 `true`；16 KiB zipalign 独立复核通过。

## 自动化与构建证据

- 版本、归档、Android 插件边界与 WebView 发布定向测试：24/24 通过。
- `pnpm check`：类型检查、ESLint、271/271 测试通过。
- Web production build：637 个模块构建通过；只有既有 chunk 体积提示。
- Release 构建：`testReleaseUnitTest`、`lintRelease`、四 ABI CMake 与 `assembleRelease` 通过；Gradle `BUILD SUCCESSFUL`。
- 构建脚本与独立后验得到相同 APK SHA-256；Gradle 输出 APK 与版本化归档逐字节一致。
- 构建期间出现 Android SDK XML v4 与当前 CMake 工具只理解到 v3 的兼容提示，但未影响四 ABI 编译、lint、签名或 APK 生成。
- `git diff --check` 与严格 UTF-8/U+FFFD 扫描通过。

## 尚未通过的门禁

- 构建前 `adb devices -l` 没有连接设备，本轮没有执行正常覆盖安装、冷启动、旧数据保留或真实 AI/本地视频端测。
- v0.1.8 尚未人工上传，也未从公网重新下载并核对大小和 SHA-256；`download.html` 继续推荐已发布的 v0.1.7。
- 因此当前结论是“已签名、可交付端测的 Release 候选”，不是物理真机验收通过或正式公开发布。
