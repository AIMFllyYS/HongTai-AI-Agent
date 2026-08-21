# v0.1.20 Release 候选验收记录（本机归档，尚未公网）

## 目标与范围

- 用户可感知结果：加号入口不再变成「页面不存在」，拆解「上传视频」恢复为完整卡片，页面层按未归档稿收口后进入独立签名 Android Release 候选。
- 架构归属：Web UI 路由、拆解首页、设置关于页与 Android Release 打包。
- 明确不做：不更新 `download.html` 推荐版本；不声称物理真机、真实 AI Provider 或制作主链已通过。

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
| 公网地址 | 尚未上传；公开推荐仍为 `v0.1.19` |

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内执行）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`：通过。
- Gradle `:app:lintRelease`：通过。
- Gradle `:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点和本地 APK SHA-256 后验：通过。

## 公网回验

本候选尚未上传。`download.html` 继续推荐公开的 `v0.1.19`。

## 真实性边界

- 未在物理 Android 设备安装或覆盖升级。
- 未使用真实 AI Provider 分析真实照片。
- 不得把本机归档表述为已公开、真机、真实模型或制作主链已经验收通过。

## 当前发布状态

本文件记录的 `v0.1.20` 已完成本机签名归档：`output/apk-archive/HongTai-AI-Agent-release-v0.1.20.apk` 为 23,311,721 字节、SHA-256 `572d4901f3300615c6c85c3edbaa766e3df6e60a23c777de0d1b08424f6fa0a8`。下载页仍推荐公开的 `v0.1.19`。公开分发、物理 Android 真机、真实 AI Provider 与两条制作主链均未在本候选完成验收。
