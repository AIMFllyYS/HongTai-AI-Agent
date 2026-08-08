# 宏泰 AI 智能体

面向大健康门店老板的本地优先 Android AI 应用。交付形态是独立 APK：React 是**应用界面层**，共享 TypeScript 是**本地应用逻辑层**，Capacitor/Kotlin 是**平台运行时与原生能力层**；本项目没有传统远程 Web 后端。

> 当前能力、发布边界和修复优先级见[当前能力与发布状态](docs/当前能力与发布状态.md)。当前 `v0.0.1` 是 QA 产物，不可作为正式 release 分发。

## 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 本地档案、AI 设置 | 已接入 | OpenAI 兼容连接保存在设备本地，API Key 仅进入 Android Keystore |
| 公开链接采集 | 已接入 | 公开单条作品的七阶段采集、媒体与文稿产物 |
| 内容拆解 | 已接入 | 用户确认后基于真实转写或图文证据生成 `content-analysis.v1` |
| 舌象/面部观察 | 已接入 | 单张私有图片、结构化日常观察报告与追问；不是医疗诊断 |
| 本地视频制作 | 已接入 | 基于正式内容拆解导入本机素材，生成计划并在设备合成竖屏 MP4 |
| 素材库、发布 | 未接入 | 页面只展示明确的 `planned` 状态，不伪造上传或发布结果 |

## 架构一览

```text
React UI（apps/web）
        ↓ 仅使用 AppRuntime 与版本化 DTO
Capacitor Runtime（packages/capacitor-runtime）
        ↓ 组合共享 Flow 与 Android I/O 端口
core + ai + platforms（共享 TypeScript 应用逻辑）
        ↓
Android 原生插件（android/app）
        ↓
Keystore、私有文件、Photo Picker、受控网络、Media3
```

- `core`、`ai`、`platforms` 不导入 Node、浏览器、Capacitor 或 Android API。
- Kotlin 只做系统 I/O；不复制 Prompt、Schema、平台解析、业务状态机或 UI 决策。
- CLI 是开发期回归入口，不是 APK 的服务端或运行依赖。
- 详细规则见[架构与工程规范](docs/架构与工程规范.md)，AI/开发任务规则见[AGENTS.md](AGENTS.md)。

## 环境与安装

- Node.js 24；
- pnpm 10；
- CLI 媒体回归需要 `ffmpeg` 与 `ffprobe`；
- Android 构建需要 Android SDK 与 JDK 21。

```powershell
pnpm install
pnpm check
```

开发 Web 界面：

```powershell
pnpm --filter @hongtai/web dev
```

CLI 回归示例：

```powershell
pnpm cli ingest "公开视频链接"
pnpm cli analyze-content "任务ID"
pnpm cli diagnosis serve
```

CLI 的 `.env` 只用于开发机回归，不能进入 APK、Git、日志或 ADB 参数。安装后的 APK 必须从设置页写入自身安全存储。完整配置、产物格式与人工回归边界见[CLI运行与产物说明](docs/CLI运行与产物说明.md)。

## 构建 Debug APK

```powershell
pnpm --filter @hongtai/web build
pnpm exec cap sync android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Push-Location android
.\gradlew.bat :app:assembleDebug --no-daemon
Pop-Location
```

输出为 `android/app/build/outputs/apk/debug/app-debug.apk`。它使用 Android debug 签名，仅用于开发和 QA。

正式发布前不得跳过以下检查：团队 release keystore、递增 `versionCode`、APK SHA-256、不带降级参数的同签名正常升级，以及涉及相册/相机/网络/Media3 的物理真机证据。当前阻断项见[发布状态](docs/当前能力与发布状态.md)。

## 验证入口

```powershell
pnpm check
pnpm --filter @hongtai/web build
Push-Location android
.\gradlew.bat :app:lintDebug --no-daemon
Pop-Location
```

按改动类型选择完整验证，不以“能编译”代替真机或发布验收；见[任务执行模板](docs/任务执行模板.md)。

## 文档

- [文档索引与职责](docs/文档索引.md)
- [当前能力与发布状态](docs/当前能力与发布状态.md)
- [架构与工程规范](docs/架构与工程规范.md)
- [应用界面层数据对接清单](docs/前端显示板块对接清单.md)
- [错误码与应用界面通知约定](docs/错误码与前端通知约定.md)
- [AI应用能力层架构](docs/AI应用能力层架构.md)
- [任务执行模板](docs/任务执行模板.md)
