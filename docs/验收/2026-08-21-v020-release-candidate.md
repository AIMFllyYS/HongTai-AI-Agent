# v0.1.20 Release 验收记录（公网已发布，真机待验）

## 目标与范围

- 用户可感知结果：加号入口不再变成「页面不存在」，拆解「上传视频」恢复为完整卡片，页面层按未归档稿收口后进入独立签名 Android Release，并完成公网文件回验。
- 架构归属：Web UI 路由、拆解首页、设置关于页与 Android Release 打包。
- 明确不做：不声称物理真机、真实 AI Provider 或制作主链已通过。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.20` |
| versionCode | `28` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.20.apk` |
| 文件大小 | `23,311,721` bytes |
| APK SHA-256 | `572d4901f3300615c6c85c3edbaa766e3df6e60a23c777de0d1b08424f6fa0a8` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk` |

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和本地 APK SHA-256 后验：通过。

## 公网回验

2026-08-21 从 `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.20.apk` 重新下载，得到 23,311,721 字节、SHA-256 `572d4901f3300615c6c85c3edbaa766e3df6e60a23c777de0d1b08424f6fa0a8`，与本地归档 `output/apk-archive/HongTai-AI-Agent-release-v0.1.20.apk` 逐字节一致。`download.html` 现推荐该公开文件。

## 真实性边界

- 未在物理 Android 设备安装或覆盖升级。
- 未使用真实 AI Provider 分析真实照片。
- 不得把公网哈希回验表述为真机、真实模型或制作主链已经验收通过。

## 当前发布状态

本文件记录的 `v0.1.20` 已完成固定公网地址上传，并从公网重新下载核对得到与本地归档一致的 23,311,721 字节和 SHA-256 `572d4901f3300615c6c85c3edbaa766e3df6e60a23c777de0d1b08424f6fa0a8`；`download.html` 现推荐公开的 `v0.1.20`。公开分发只证明文件身份和下载链路已回验，不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
