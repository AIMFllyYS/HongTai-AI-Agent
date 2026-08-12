# 2026-08-11 一键 AI 配置、云端 TTS 与 v0.1.2

## 任务契约

## 目标

- 将视频配音并入唯一的 AI 连接配置，不再保留独立 TTS 设置页或第二套密钥存储。
- 为小米 MiMo 与阶跃星辰提供“一键配置”：用户选择供应商、输入一次 API Key，应用写入准确的文本、视觉、ASR 与视频配音协议参数并保存到本机。
- 让素材剪辑模式真正调用已配置的云端 TTS 并将 WAV 私有化后交给本地 Media3 合成；数字人口播继续使用上传视频的原声并只叠加字幕。
- 将候选版本递增为 `0.1.2` / `versionCode=9`。

## 允许修改

- `packages/core`、`packages/ai`、`packages/capacitor-runtime` 的版本化 AI 配置、ASR/TTS 协议和制作调用契约。
- `apps/web` 的 AI 配置、制作与设置路由；`android/app` 的受控 Keystore、网络和私有媒体 I/O。
- 受影响测试、当前能力文档与本验收记录。

## 明确不做

- 不保存、回显、写入日志、提交或打包任何 API Key；不新增云端后端、账户、同步或数据库。
- 不把直接 Provider HTTP 验证、JVM 测试、Debug 构建或模拟器证据表述为物理真机、完整 Media3 E2E 或正式 release 验收。
- 不改变数字人口播的原声语义，不把供应商 reasoning、原始响应或音频 Base64 暴露到 WebView。

## 架构归属

- 所属层：core（公开 DTO/预设）、ai（StepFun ASR SSE 协议）、capacitor-runtime（唯一状态源与渲染模式）、UI（仅经 `AppRuntime`）、Android I/O（Keystore、HTTPS、私有 WAV）。
- 页面不读取 API Key、私有文件路径或 Provider 原始响应；Kotlin 不决定业务文案、制作计划或供应商选择，只执行已保存的受控技术协议。

## 权威状态与数据

- 一份 `LocalAiConnection` 是唯一公开配置状态；Key 仅由 `AndroidKeystoreSecretStore` 的 `active-ai-connection` 槽位持有。
- 素材剪辑项目在开始渲染时读取该配置：完整云端 TTS 配置走 `provider`，未配置时才走 Android 系统语音；数字人口播不合成新旁白。
- 每段云端音频先写入项目私有 `.part.wav`，验证 RIFF/WAVE 后才替换成功段；探测音频写入 cache 后立即删除。

## 验收

- 定向测试：预设模型/端点、StepFun SSE ASR、云端 TTS 探测桥接、渲染模式传递、MiMo/StepFun TTS JSON 契约。
- 构建 / lint：`pnpm typecheck`、根测试、`pnpm --filter @hongtai/capacitor-runtime test`、Android Debug JVM、Web build、Android lint/Debug APK（最终结果补在本文末尾）。
- 浏览器或真机证据：桌面与约 390px 设置页检查；物理 Android、真实用户素材的端到端合成和同 release 升级另行验收。
- 用户实际会看到什么：AI 连接页只需选择供应商并填写 Key；四项探测可分别显示结果；素材剪辑明确显示使用 AI 连接中的 TTS 和字幕。

## 供应商协议验证

本次在内存中使用维护者授权的两把测试 Key，所有请求使用非个人短文本、合成图片和合成语音；测试后未将 Key 或原始响应写入文件、日志、APK 或 Git。

| 供应商 | 文本 / 视觉 | ASR | 视频配音 | 真实最小请求结论 |
| --- | --- | --- | --- | --- |
| 小米 MiMo | `https://api.xiaomimimo.com/v1/chat/completions`，`mimo-v2.5` | `mimo-v2.5-asr`，Chat Completions 的 `input_audio`，返回 `choices[0].message.content` | `mimo-v2.5-tts`，Chat Completions 的 `audio`，返回 `choices[0].message.audio.data` Base64 WAV | 文本、视觉、ASR、TTS 均 HTTP 200；文本/视觉为 `choices.message.content`，TTS WAV 头通过校验 |
| 阶跃星辰 | `https://api.stepfun.com/v1/chat/completions`；文本 `step-3.5-flash`，视觉 `step-1o-turbo-vision` | `POST /v1/audio/asr/sse`，`stepaudio-2.5-asr`，SSE `transcript.text.*` | `POST /v1/audio/speech`，`stepaudio-2.5-tts`，二进制 WAV | 文本、视觉、ASR、TTS 均 HTTP 200；ASR 接到终态 SSE 事件，TTS WAV 头通过校验 |

阶跃的同一授权 Key 下，`step-3` 返回 HTTP 404；`step-3.5-flash` 的图片输入返回 HTTP 400（模型不支持图片输入）。因此一键预设明确使用实际通过的 `step-1o-turbo-vision`，而不是按模型名称猜测或把失败的模型写入用户配置。

## 实施结果

- 删除 `/settings/tts`、`TtsSettingsPage` 和 Android 的系统 TTS 设置 Intent；TTS 模型、传输方式和音色成为 AI 连接的同一份公开元数据。
- 一键预设持久化精确的 Base URL、四类模型和传输方式；Key 保持仅写入。高级兼容配置仍可用于未列出的 OpenAI 兼容供应商。
- 新增 `stepaudio-sse` 适配器：仅接受 WAV/MP3/OGG/PCM，原生传输以 raw Base64 写入 `/audio/data`，只返回完成转写文本。
- 新增 Android `CloudNarrationSynthesizer`：MiMo 解析 Chat Audio Base64 WAV，阶跃读取 `/audio/speech` 二进制 WAV；请求只能相对保存的 HTTPS Base URL，Network Policy 阻断局域网/路径逃逸；Provider 错误正文被丢弃。
- 制作服务显式向原生传递 `narration: provider | system`，稳定错误不再错误地只指向系统 TTS。

## 当前验证证据

- `pnpm check`：228/228 通过（含一键预设、StepFun ASR SSE、云端 TTS 传递、旧旁白段失败恢复、版本门禁与安全边界）。
- `pnpm --filter @hongtai/web build`、`pnpm exec cap sync android` 与生成 `config.xml` 的 UTF-8 规范化通过；构建工具仅报告 JavaScript bundle 大于 500 kB 的非阻断体积建议。
- `:app:testDebugUnitTest` 通过（使用 Android Studio JBR 21；系统默认 JDK 17 不满足本项目 Java 21 要求，未修改系统环境）。其中 `NarrationFileFinalizerTest` 覆盖“替换失败后恢复旧旁白段”和“成功后删除备份”。
- `:app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest` 通过；四 ABI HEIF native 目标、Debug lint、主 APK 与配套 androidTest APK 均已生成。
- 浏览器视觉检查：已检查桌面与 390×844 视口的 AI 连接页。固定标题不再遮住第一张安全说明卡；小米和阶跃预设的四种模型均可读，390px 下保存按钮可滚动到固定底部导航之上并可触达。
- 直接 Provider 最小调用：两家供应商的四类协议均按上表通过；这验证端点、认证、模型和输出结构，不替代 APK 真机网络或视频导出验收。
- 最终 Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`，包 `com.hongtai.aiagent`，`versionCode=9`，`versionName=0.1.2`，39,124,630 bytes，SHA-256 `E8FE0BF5A3AEF98097CAFD84FD46143D724592AEF6436356E811F55A27851FA7`。`apksigner verify --verbose` 显示 Debug APK 使用 v2 签名；这不是 release 签名验收。
- 配套 androidTest APK：`android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`，590,698 bytes，SHA-256 `61CADFC512A21563633847DDF192E1CB2B190C286BA54998E4D546FCB97306D4`。

## 交付边界

- 本机 `adb devices -l` 未发现已授权设备，因此本轮没有把 Debug APK 安装到物理机或模拟器；没有声称云端 TTS、系统选择器、真实素材 Media3 导出、字幕可见性或正常升级已在新 APK 中通过。
- Debug 证书与正式 release 证书不同。该 APK 不能证明 #5 的同 release 证书升级、证书锚点、v2/v3 release 签名或正式分发资格。
- `v0.1.1` 的系统 TTS 页面记录保留为历史事实；当前实现以本记录为准，不再提供独立 TTS 页面。由于 `v0.1.1`/8 已存在，本轮后续功能使用单调递增的 `v0.1.2`/9，而不覆盖或降级先前构建。
