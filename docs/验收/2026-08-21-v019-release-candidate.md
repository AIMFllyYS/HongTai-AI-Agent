# v0.1.19 Release 验收记录（本地已归档，公网未回验，真机待验）

## 目标与范围

- 用户可感知结果：未归档设计稿的观察、设置、模板与底栏进入独立签名 Android Release，并更新 `download.html` 推荐版本。
- 架构归属：Web UI、共享 core/ai、platforms 互动量字段、Capacitor 组合层与 Android Release 打包。
- 明确不做：不从公网重新下载核对哈希；不声称物理真机、真实 AI Provider 或公开文件已回验。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.19` |
| versionCode | `27` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.19.apk` |
| 文件大小 | `23,202,490` bytes |
| APK SHA-256 | `b47a95f68900804c43f15ab2472d598c1e78355bce53f75a285df68aa4aaeb1b` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 推断公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.19.apk` |

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和本地 APK SHA-256 后验：通过。

## 公网回验

本次按维护者要求跳过公网重新下载与哈希核对。`download.html` 仍按既有固定目录推断下载链接，不表示公开文件已与本地归档逐字节一致。

## 真实性边界

- 未在物理 Android 设备安装或覆盖升级。
- 未使用真实 AI Provider 分析真实照片。
- 不得把主机 Release 构建成功表述为真机、真实模型或公开文件回验通过。

## 当前发布状态

本文件记录的 `v0.1.19` 已完成正式签名与本地归档；`download.html` 现推荐该版本。公开分发文件身份尚未回验，也不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
