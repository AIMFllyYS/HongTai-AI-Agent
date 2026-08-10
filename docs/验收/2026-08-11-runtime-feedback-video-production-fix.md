# 2026-08-11 运行反馈与本地视频制作修复

## 任务契约

## 目标

- 移除 Android 原生和 Web 同时处理安全区造成的页面顶部双重留白；绿色操作按钮使用可读的深色前景。
- 在内容拆解、面部观察和舌象观察请求期间展示来自真实 Provider `content_delta` 的安全结构化进度，不伪造字符流，也不向页面泄露模型 reasoning、原始响应或密钥。
- 让本地视频制作能将可验证素材、明确的合成模式和原生失败分类串成可恢复的真实链路：
  - 素材剪辑：图片或视频素材、中文系统 TTS、样式化字幕、H.264/AAC MP4。
  - 数字人口播：一段带原声的 MP4 与用户确认的口播稿；保留原声，在本地切分字幕，不将 AI 推测伪装为语音转写。

## 允许修改

- `apps/web` 的安全区显示、按钮 token、制作入口和运行中反馈组件。
- `packages/core`、`packages/ai`、`packages/capacitor-runtime` 的版本化 DTO、生产计划、事件转发和错误映射。
- `android/app` 的边到边窗口、受控媒体导入、Media3 渲染、TTS 和稳定错误码。
- 受影响单元、边界、Android 测试和当前能力文档。

## 明确不做

- 不新增云端后端、登录、同步、素材库、发布能力、宽泛存储权限或规避系统选择器。
- 不把 Debug APK、浏览器检查或模拟器结果表述为物理真机或正式 release 验收；不改 release 签名、`versionCode` 或发布链。
- 不把数字人视频的用户口播稿替换为模型生成文本；不把受限的设备 TTS 可用性伪装成成功。

## 架构归属

- 所属层：Web UI、core、AI Flow、Capacitor 组合层、Android I/O。
- UI 仅消费 `AppRuntime` 的稳定 DTO 和安全进度摘要；Core/AI 不导入浏览器、Capacitor 或 Android API；Kotlin 只处理媒体 I/O、系统 TTS 和稳定错误码，不决定业务文案或 AI 规则。

## 权威状态与数据

- 内容拆解以 `taskId`、图片观察以 `sessionId`、视频制作以 `projectId` 为唯一持久状态源。
- 流式预览仅是内存中的受限展示，完成、失败、取消与重试仍以持久化的 `content-analysis.v1`、`image-observation.v1` 和 `production-plan.v1` 终态为准。
- 导入媒体先验证类型、轨道、时长与图像尺寸；成片先写临时文件，成功后受控替换，失败时保留先前成功成片。

## 验收

- 定向测试：安全流式摘要、数字人口播字幕计划、生产计划约束、Android 插件边界和移动端布局契约。
- 构建 / lint：`pnpm check`、Web build、Android JVM 测试、`lintDebug`、Debug APK 与 androidTest APK 构建。
- 浏览器或真机证据：桌面与约 390px 浏览器截图检查；物理 Android 设备在本机连接后另行执行安装、冷启动、素材选择、TTS、字幕和导出验证。
- 用户实际会看到什么：没有额外顶部白条；绿色按钮文字清晰；AI 运行时能看到实际阶段、已接收内容量和已识别段落；视频制作可明确选择两种模式，并在错误时获得可行动的原因而不是笼统“合成失败”。

## 交付说明

- 改了什么：消除双重安全区、补足颜色对比、转发安全的真实流式进度、硬化导入/渲染/TTS/输出完成路径，并增加字幕与数字人口播模式。
- 刻意没有做什么：不生成虚假进度、不伪造 ASR、不覆盖原视频声音、不改正式发布链。
- 剩余风险或新增 Issue：设备没有中文 TTS 引擎、特定编码器或 OEM Media3 行为仍须以真实设备覆盖；本轮 Debug APK 不能替代正式签名升级验收。

## 本地验证证据

- `pnpm check`：222/222 通过（包含 TypeScript、lint、Windows 原生依赖与签名边界门禁）。
- Web：`pnpm --filter @hongtai/web build` 通过；已用桌面与约 390px 浏览器布局检查确认页面从 y=0 开始，未出现额外顶部白条，绿色次要操作使用深色前景。
- Android：在 Android Studio JBR 21、Android SDK 环境下执行 `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --rerun-tasks` 成功；四 ABI HEIF native 构建、Debug JVM 测试、lint、主 APK 与 androidTest APK 均生成。
- 新 Debug APK：`com.hongtai.aiagent`，`versionCode=7`，`versionName=0.0.1`，39,043,786 bytes，SHA-256 `370C628A4AAF8E6CEB9D3AB877DE58AFE6AF8B9D920FF0E01367E72D34144714`。`apksigner verify --verbose` 显示 Debug APK 使用 v2 签名；这不是 release 签名验收。
- 配套 androidTest APK SHA-256：`0746CCD5F98FBA5D2DF903280FBFC4ED09EABD6BB42C86003689B59A5FEF3442`。
- 物理设备：构建时 `adb devices -l` 未发现已连接设备。因此本记录没有声称冷启动、系统选择器、TTS、Media3 导出或 Android 7.x fallback 已在物理机通过。
