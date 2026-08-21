# v0.1.21 Release 验收记录（公网 APK 已回验，下载页 HTML 待同步，真机待验）

## 目标与范围

- 用户可感知结果：全应用动效统一、切页与弹层更顺，关于页可打开官方更新日志；页面层与下载页说明对齐后进入独立签名 Android Release。
- 架构归属：Web UI 动效、设置关于/更新日志、下载页与 Android Release 打包。
- 明确不做：不声称物理真机、真实 AI Provider 或制作主链已通过。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.21` |
| versionCode | `29` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.21.apk` |
| 文件大小 | `23,323,128` bytes |
| APK SHA-256 | `e95b1a1e0845522bbd25469ac2e6f8f4f42f117bed020c8c15a8e6826102cdfd` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.21.apk` |

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过（脚本门禁内）。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和本地 APK SHA-256 后验：通过。

## 公网回验

2026-08-21 从 `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.21.apk` 重新下载，得到 23,323,128 字节、SHA-256 `e95b1a1e0845522bbd25469ac2e6f8f4f42f117bed020c8c15a8e6826102cdfd`，与本地归档 `output/apk-archive/HongTai-AI-Agent-release-v0.1.21.apk` 一致。

同日核对 `https://husteread.com/HongTai/download.html`：线上页面仍推荐 `v0.1.20`，尚未包含 `v0.1.21` 文案与校验码。仓库根目录 `download.html` 已更新为推荐 `v0.1.21`，需再次上传该文件后，下载站推荐口径才与公开 APK 对齐。

## 真实性边界

- 未在物理 Android 设备安装或覆盖升级。
- 未使用真实 AI Provider 分析真实照片。
- 不得把公网 APK 哈希回验表述为真机、真实模型或制作主链已经验收通过。

## 当前发布状态

本文件记录的 `v0.1.21` 已完成主机 Release 构建、正式签名、本地归档，以及公开 APK 文件回验；仓库 `download.html` 已推荐该版本，但 husteread 上的下载页 HTML 仍待同步。公开分发只证明 APK 文件身份和下载链路已回验，不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
