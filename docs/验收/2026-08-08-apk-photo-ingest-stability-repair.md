# APK 图片面诊与手机端链接解析稳定性验收

> **历史验收记录。** 本文仅说明 2026-08-08 当时的实现与模拟器证据；外部相机/相册生命周期、链接诊断和真机结论以[当前能力与发布状态](../当前能力与发布状态.md)及其 Issue 为准。

日期：2026-08-08
构建：`android/app/build/outputs/apk/debug/app-debug.apk`
SHA-256：`AA6E9705044C1A15F3D0E42FAD68EA6AC450815132C629692100818F6DCC83B0`
设备：Android Emulator API 35，包名 `com.hongtai.aiagent`

## 结论

本次回归没有复现“合成视频功能直接破坏图片上传或链接解析”的证据。两条链路在干净安装的新 APK 上均完成了真实端到端运行。问题根因是两个边界在功能扩展后被放大：

1. 系统相册常见的 HEIC/HEIF 图片原先没有进入导入策略；导入策略只接受 JPEG、PNG、WebP，导致部分真实手机照片在选择后无法进入私有图片存储。
2. 链接采集任务运行在前台 WebView 进程内。应用启动时会把上次留下的 `running` 快照标记为 `interrupted`，不会跨进程恢复。长视频下载、音频分段和 ASR 将这个生命周期边界暴露得更明显。

本次最小修复：

- 在 `PrivateMediaImportPolicy` 接受 `image/heic`、`image/heif` 及 `.heic`、`.heif`；仍统一经过现有 Bitmap 解码、EXIF 方向处理、缩放和 JPEG 私有落盘契约，不改变 WebView/AI 接口。
- 在 `MainActivity` 设置 `FLAG_KEEP_SCREEN_ON`，避免用户等待前台任务时因屏幕超时进入隐藏状态。该标志只解决前台等待期间的休眠，不等同于后台服务或进程被杀后的断点续传。

没有新增数据库、后台 Service、第二套任务状态机、平台解析器或视频合成链路改动。

## 真实端到端证据

### 图片面诊

- 通过应用 Photo Picker 选择真实相册图片；页面上的“生成观察报告”从禁用变为可用。
- 会话：`observation-fe7dd08ac5674c0c80eedb67bd82636d`
- 私有原图：`files/observations/<session>/image.jpg`，216,513 bytes。
- 导入副本：`files/media/imports/e2a1f074-55c3-4488-a08e-23240e81e8a1.jpg`，216,513 bytes，与会话图尺寸一致。
- `session.json`：`reportStatus=succeeded`，`mimeType=image/jpeg`。
- `report.json`：`schemaVersion=diagnosis-report.v1`，视觉模型识别出测试图片是应用界面截图并给出重拍建议，证明真实图片字节已经进入视觉分析链路。

当前设备没有可安全取出的 HEIC 相册样本，因此 HEIC 的“真实设备选择”未冒充已完成；其覆盖由 Android 官方平台解码能力、导入策略单测和现有正常化器契约共同验证。需在一台实际产出 HEIC 的手机上补做一次人工验收。

### 手机端链接解析

- 输入：`https://v.douyin.com/P3q_lN_8d84/`
- 任务：`task-acfa3443259a424b9811d9904ae5cd9d`
- 最终状态：`succeeded`，`currentStage=save-artifacts`，`speechStatus=transcribed`，无 issues。
- 短链解析到 `https://www.douyin.com/video/7669588497125080677`；标题、作者和 H.264 媒体源均成功提取。
- 视频文件：27,705,850 bytes；事件流显示下载从 0% 连续到 100%，随后媒体校验、音频分段、ASR、文稿保存全部完成，共 43 个有序事件，没有中途断链。
- `metadata.json`：标题“原来古人诚不欺我，千里江山图真的存在！”，作者“姜也”，时长 7.467 秒。
- `transcript/transcript.json`：`speechStatus=transcribed`，来源 `asr`。

## 自动化门禁

- 根测试、类型检查和 lint：`177/177` 通过。
- `@hongtai/capacitor-runtime`：`24/24` 通过。
- Android JVM 单测：通过。
- Android instrumentation：`2/2` 通过。
- Web build：通过（仅有已有的 chunk 体积提示）。
- `git diff --check`：通过。

## 已知边界与下一步

如果用户在解析中离开应用、锁屏后系统回收进程，当前版本仍会把未完成任务标记为 `interrupted`，因为任务执行器尚未迁移到 Android 后台服务/WorkManager。本次没有扩大范围去引入第二套执行器，以免破坏现有七阶段、产物和状态契约。若产品要求“离开页面后继续并可恢复”，应另立任务设计，先定义持久化 checkpoint、重试幂等性和前台服务通知，再实施。
