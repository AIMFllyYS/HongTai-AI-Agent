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

- 源码版本已计划为 `0.1.8` / `versionCode=16`。
- 构建、APK 身份、签名、大小与 SHA-256：待验证。
