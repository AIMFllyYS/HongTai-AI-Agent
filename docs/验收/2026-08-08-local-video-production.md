# 2026-08-08 本地爆款视频制作 APK 验收

> **历史验收记录。** 本文仅说明 2026-08-08 当时的本地视频制作证据；当前生命周期、并发、存储和正式 release 风险以[当前能力与发布状态](../当前能力与发布状态.md)为准。

## 验收范围

本次在既有七阶段采集、`content-analysis.v1` 和图片观察能力之外，增加一条最小可维护的视频制作纵向链路：

`正式内容拆解 → 用户选择本机素材 → production-plan.v1 → Android 系统 TTS → Media3 本地合成 → 私有 MP4`

没有修改平台解析器、七阶段采集流程、内容拆解 Prompt 或 Schema，也没有增加数据库、后台任务框架、素材库或发布系统。

## 最终实现

- 制作页只列出具有正式 `content-analysis.v1` 的任务；
- 每个制作项目保存来源任务、经营需求、目标时长、用户素材、正式计划和成片；
- AI 计划只能引用当前项目真实素材 ID，镜头连续且总时长必须精确匹配 15、30、45 或 60 秒；
- Android 使用系统选择器导入 JPEG、PNG、WebP、MP4、MP3、M4A 或 WAV；
- Android 系统 TTS 按镜头分段生成中文旁白，优先使用同语言离线 Voice，首次失败只重试一次；
- Media3 合成字幕、旁白和用户画面，固定输出 H.264/AAC、30fps、竖屏显示尺寸 720×1280 的 MP4；
- 素材库和发布仍为 `planned`，没有伪上传、伪发布或伪生成。

## 模拟器真实业务链路

设备：Android Emulator `sdk_gphone64_x86_64`，Android 15，API 35。

1. APK 设置页写入主工作区 `.env` 中的 API Key 和模型名；由于该 `.env` 缺少 `HONGTAI_AI_BASE_URL`，Base URL 在页面中补录为 MiMo 官方 OpenAI 兼容地址。配置只进入模拟器私有偏好与 Keystore，没有写入 APK、Git、日志或 ADB 参数。
2. 文本能力探测显示 `mimo-v2.5` 测试通过。
3. APK 使用公开抖音分享链接创建任务 `task-ef6607631864410d8fabfccfb1f7303f`，完成真实平台解析、媒体下载、453 字文稿、七阶段事件和私有产物保存。
4. 用户确认后生成并展示正式 `content-analysis.v1`，证据为 3 个真实文稿片段。
5. 制作项目 `bffc1a4e-f1c7-49a8-b1f1-e56a4e10aec1` 导入 3 张系统选择器图片，AI 生成 4 镜头、总时长精确 15 秒的 `production-plan.v1`。
6. Android 本地合成成功，页面中的视频元素 `readyState=4`、时长 15.0 秒，可直接播放。

验收期间发现并修复了两个只会在真实链路暴露的问题：首次中文 TTS 下载离线语音包时网络 Voice 超时；模拟器默认 HEVC 编码器自动降级分辨率。最终实现采用离线 Voice 选择加一次重试，并强制 H.264，以保持竖屏交付契约。

## 成片独立探测

通过 `ffprobe` 直接读取应用私有成片的验证副本：

- 容器：MP4；
- 时长：`15.000000` 秒；
- 视频：H.264，30fps，编码尺寸 1280×720，旋转矩阵 `-90°`，实际显示尺寸 720×1280；
- 音频：AAC；
- 文件大小：981,211 字节；
- SHA-256：`7817CEA908285C021D7C667DA59100809EF01F68304A639F873561E591AB16D8`。

## 自动门禁

- `pnpm check`：TypeScript、ESLint 和根测试；
- `pnpm --filter @hongtai/capacitor-runtime test`：运行时定向测试；
- `pnpm --filter @hongtai/web build`：Web 生产构建；
- `:app:testDebugUnitTest`：Android JVM 单元测试；
- `:app:connectedDebugAndroidTest`：真实私有图片导入和本地视频合成 instrumentation；
- `:app:assembleDebug`：debug APK 构建；
- `git diff --check`、UTF-8 替换字符扫描和敏感信息扫描。

## 交付 APK

- 路径：`C:\Users\AIMFl\.codex\worktrees\aec9\HongTai-AI-Agent\android\app\build\outputs\apk\debug\app-debug.apk`
- 应用 ID：`com.hongtai.aiagent`
- 版本：`0.2.0 (2)`
- 最低 API：24；目标 API：36
- 文件大小：16,053,290 字节
- SHA-256：`A439B23B6D3AEB6E619DF778597B360290F00AB5315D524260DF2931A8148275`

这是经过模拟器真实安装、真实平台采集、真实 AI 拆解、真实素材导入和本地视频合成验证的 debug APK。尚未连接物理设备，因此不声明物理真机、发布签名或 release 包验收通过。
