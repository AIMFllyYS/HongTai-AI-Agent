# v0.1.22 Release 验收记录（公网 APK 已回验，下载页已同步，真机待验）

## 目标与范围

- 用户可感知结果：修复到顶/到底猛拉时整页拉伸、跟着晃动的问题（不引入上拉刷新，惯性滚动不受影响）；深色模式配色补齐；观察报告新增底部胶囊追问与「AI 追问」悬浮窗；设置「关于」页「本版要点」与下载页均已同步为本版真实变更。
- 架构归属：Web 前台滚动与手势契约（`foundation.css`、`shell.css`、`useSwipeNavigation`）、Android WebView overscroll 配置（`MainActivity.kt`）、设置「关于」页文案、下载页与 Android Release 打包。
- 明确不做：不声称物理真机、真实 AI Provider 或制作主链已经验收通过。

## 候选身份

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.22` |
| versionCode | `30` |
| 文件名 | `HongTai-AI-Agent-release-v0.1.22.apk` |
| 文件大小 | `23,329,541` bytes |
| APK SHA-256 | `27558531ba4ea77810761eb4a4448865ee142dccccb9754cda2216a6060d4b3e` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde` |
| 签名主体 | `CN=HongTai AI Agent Release, O=HongTai AI Agent, C=CN` |
| 公网地址 | `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.22.apk` |

## 本版变更摘要

- 修复：到顶或到底再猛拉时页面不再整页拉伸或跟着晃；上下惯性滚动仍可用，没有上拉刷新。
- 优化：深色模式补全淡绿底、状态软底与观察纸面 token；确认图片后直接进入「AI 正在观察」进行中页；观察报告「日常建议」改为单列；观察报告详情页改为底部胶囊追问输入并支持「AI 追问」悬浮窗。
- 详见 `CHANGELOG.md` 的 `[0.1.22] - 2026-08-21` 小节。

## 主机验证

- 官方入口 `scripts/build-android-release.ps1`：通过（内部依次执行 Web production build、Capacitor sync、Release 单元测试、`lintRelease`、`assembleRelease`、16 KiB zipalign、包身份、版本、正式签名与本地 SHA-256 后验）。
- `pnpm check`（typecheck + lint + 全部单元测试）：通过，124 项测试全部通过。
- `pnpm --filter @hongtai/web build`：通过（脚本内已重复执行一次，独立执行同样通过）。
- Capacitor Android sync 与 `normalize-capacitor-config.ps1`：通过。
- Gradle `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`：通过，四 ABI。
- 16 KiB zipalign、包身份、版本、v2/v3 正式签名、证书锚点与本地 APK SHA-256 后验：通过。

## 公网回验

2026-08-21 从 `https://husteread.com/storage/public/HongTai-AI-Agent-release-v0.1.22.apk` 重新下载，得到 23,329,541 字节、SHA-256 `27558531ba4ea77810761eb4a4448865ee142dccccb9754cda2216a6060d4b3e`，与本地归档 `output/apk-archive/HongTai-AI-Agent-release-v0.1.22.apk` 完全一致。

仓库根目录 `download.html` 已更新为推荐 `v0.1.22`：hero 区、`spec-card`、`RELEASES` 与 `CHANGELOG` 两个 JS 数组均已同步，`v0.1.21` 保留为历史版本。husteread 站点实际渲染的 HTML 页面是否已重新部署未在本次任务范围内核对，仅确认了 APK 文件本身可从公网地址下载且哈希一致。

## 真实性边界

- 未在物理 Android 设备安装或覆盖升级。
- 未使用真实 AI Provider 分析真实照片。
- 不得把公网 APK 哈希回验表述为真机、真实模型或制作主链已经验收通过。

## 当前发布状态

本文件记录的 `v0.1.22` 已完成主机 Release 构建、正式签名、本地归档，以及公开 APK 文件回验；仓库 `download.html` 已推荐该版本。公开分发只证明 APK 文件身份和下载链路已回验，不等于物理 Android 真机、真实 AI Provider 或两条制作主链已经验收通过。
