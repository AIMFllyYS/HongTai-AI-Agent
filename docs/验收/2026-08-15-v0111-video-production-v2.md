# v0.1.11 视频制作 v2 验收

> 日期：2026-08-15
>
> 阶段：三阶段功能扩展的阶段 3
>
> 结论：`0.1.11` / `versionCode=19` Release 候选通过自动化、主机签名构建、API 35 Release instrumentation 的真实 Media3 编码和最终归档 APK 端测；没有物理手机、真实供应商调用、公开上传或公网哈希回验，因此不是正式发布证明。

## 范围与数据边界

- `production-plan.v2` 新增 `textOverlay`，包括主文字、可选副文字和 `classic_top`、`clean_card`、`aqua_accent` 三种预设；旧 `production-plan.v1` 继续兼容读取。
- 制作页可填写最多 24 个字符的主文字并选择预设；未填写时由 AI 生成。页面只通过 `AppRuntime` 提交字段，不读取私有文件或供应商响应。
- 规划请求同时包含来源任务的原始文稿和正式拆解，并在两段参考内容之前固定加入“仅供创作参考、可以吸收结构与思路、不得作为本次口播内容”的约束。
- 原始文稿只从任务详情按现有 DTO 读取，在单次规划调用中最多使用 12,000 个字符；不写入制作项目、页面 DTO 或日志。
- 新口播若包含参考原文中的连续 12 个规范化字符，Flow 会使用唯一一次修复重新组织表达；修复仍携带同一参考边界和正式结构化 Schema。
- Kotlin 不决定文案或业务流程，只解析经过校验的 v1/v2 计划，并让既有 Media3 渲染器在每个镜头叠加顶部主文字和底部短字幕。

## 参考视频分析

- 用户提供的参考视频仅用于确认视觉下限，没有复制、移动或提交到 Git。
- `ffprobe`：9.751678 秒，720×1280，30 fps，HEVC 视频加 AAC 单声道 44.1 kHz，文件大小 1,181,237 字节。
- 接触表确认其核心样式是竖屏真人口播、顶部两行常驻主文字和底部随文稿变化的高对比字幕。
- 本地 ASR 只作为实现分析证据；识别内容大意是“寻找 3–5 个合伙伙伴、提供场地和货、伙伴投入人和时间”。它没有进入产品默认口播、测试快照或 Git。

## 自动化证据

- 制作 Prompt、Schema、原创性修复、项目持久化边界、Web 输入和 Android parser 等定向测试：48/48 通过。
- `pnpm typecheck`、ESLint 与完整 `pnpm check` 通过；完整测试：278/278 通过。
- `pnpm --filter @hongtai/web build`：638 个模块转换成功。
- Release JVM `ProductionPlanParserTest` 通过；构建环境显式使用 Android Studio JBR 21 与本机 Android SDK。
- Release 脚本完成 `testReleaseUnitTest`、`lintRelease`、四 ABI native build、16 KiB zipalign、v2/v3 签名和包身份后验。

## Media3 编码端测

- 设备：只读覆盖层 AVD `SciChatApi35`，`sdk_gphone64_x86_64`，API 35，ADB `emulator-5554`。
- Android instrumentation 明确以签名 Release 为测试目标；Gradle connected runner 1/1 通过，随后直接安装签名 Release target/test APK 并用 runner 复验 1/1 通过。
- 测试只使用本地合成图片和音频作为确定性输入，但走的是真实 `ProductionRenderer`、Media3 Transformer、编码器和文件输出，不把 fixture 伪装成 AI 供应商结果。
- 生成 MP4 大小 1,164,184 字节，SHA-256 `06cba9929f469d577f6918f5b326f380afd91667e8e690089cff53e495aeaaaa`。
- `ffprobe`：15.000 秒，H.264 30 fps 加 AAC 单声道 16 kHz；编码画面 1280×720 并带 -90° 旋转元数据，播放器显示方向为 720×1280。
- 1 秒和 6 秒帧人工确认顶部持续显示“3-5人合伙 / 你出时间，我出内容”，底部分别显示“真实镜头1”和“真实镜头2”，两层文字没有相互遮挡。

## Release APK

- 构建入口：`scripts/build-android-release.ps1`。
- 归档文件：`output/apk-archive/HongTai-AI-Agent-release-v0.1.11.apk`。
- 包名：`com.hongtai.aiagent`。
- 版本：`0.1.11` / `versionCode=19`。
- 大小：28,955,602 字节。
- APK SHA-256：`79b0b8090c06d3384993334a89487bc2ca6e0a3cedc9345195a11c0466df2dba`。
- 证书 SHA-256：`54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`。

## 最终 APK 端测

- 最终归档 APK 使用 `adb install --no-streaming -r` 安装成功，未使用 `-d`；同一 code19 安装的 `firstInstallTime` 保持 `2026-08-14 17:35:45`，冷启动顶层 Activity 为 `com.hongtai.aiagent/.MainActivity`。
- 应用信息页显示版本 0.1.11、构建号 19，以及主文字预设、顶部/底部文字、参考原文边界和重复修复四条更新说明。
- 制作页在当前空数据档案中显示“还没有可用于制作的拆解”，没有为验收伪造已成功拆解任务；主文字与预设表单由自动化和 production Web bundle 证明，真实 UI 仍需先完成一个正式拆解才会出现。
- 目标包冷启动和页面切换期间未见 crash 或 ANR。
- connected instrumentation 的测试清理在 code18→code19 之间卸载了产品包，因此本阶段不声称跨版本数据保留；阶段 1 和阶段 2 的普通升级证据分别保存在对应验收文档。

## 明确未验证

- 没有物理 Android 手机，不能声称 OEM MediaCodec、真实 GPU/字体、长视频温升、内存压力、真实触控或正常升级已通过。
- 没有使用用户 API Key 调用真实 AI Provider；原创性保护、提示词上下文和结构化计划通过确定性 Provider 测试，真实模型输出仍受所选模型能力与网络影响。
- 没有用参考视频内容生成产品口播，也没有将参考视频、ASR 中间文件或 instrumentation 成片提交到 Git。
- 没有更新 `download.html`，也没有公开上传 v0.1.11 或从公网重新下载核对哈希。
