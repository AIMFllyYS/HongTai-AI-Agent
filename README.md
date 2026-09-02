# 宏泰 AI 智能体

面向大健康门店老板的本地优先 Android AI 应用。交付形态是独立 APK：React 是**应用界面层**，共享 TypeScript 是**本地应用逻辑层**，Capacitor/Kotlin 是**平台运行时与原生能力层**；本项目没有传统远程 Web 后端。

> 当前能力、发布边界和修复优先级见[当前能力与发布状态](docs/当前能力与发布状态.md)，版本与构建规则见[版本与发布流程](docs/版本与发布流程.md)。版本号的唯一来源是 `android/app/build.gradle.kts`，本文不复制第二份版本号。Release 候选期间源码版本可以暂时领先下载页；已公开分发也不等于全部门禁通过，真实模型调用与物理设备完整端测仍需单独记录。

## 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 本地档案、AI 设置 | 已接入 | OpenAI 兼容连接保存在设备本地，API Key 仅进入 Android Keystore |
| 公开链接采集 | 已接入 | 抖音、小红书、B站公开单条作品的七阶段采集、媒体与文稿产物（快手为实验性）；B站全链路（解析签名风控与 B 帧合并两个根因）已修复并随最新版本公开分发 |
| 内容拆解 | 已接入 | 用户确认后基于真实转写或图文证据一次生成，五个板块分别校验后渐显，再保存 `content-analysis.v1`；带口播的本地 MP4 复用同一链路自动拆解 |
| 舌象/面部观察 | 已接入 | 单张私有图片、五板块生成进度、结构化日常观察报告与追问；不是医疗诊断 |
| 自动状态更新 | 已接入 | 任务、拆解和观察报告通过窄订阅更新；健康状态下无需手动刷新或固定轮询 |
| 本地视频制作 | 已接入 | 智能成片、爆款复刻与数字人单视频，默认一键全自动（分镜文稿 → 逐句配音 → 组装 → 本机合成）；计划为 `production-plan.v4`（文稿先行、实测时长，旧 v3 项目只读兼容），可微调后在设备合成竖屏 MP4 |
| 模板管理 | 已接入 | 从成功拆解复制结构，或新建、编辑、删除本地模板；统一显示本地视频首帧封面，长按重命名，与来源拆解联动删除并二次确认 |
| 存储管理 | 已接入 | 设置页展示六类真实占用分布，缓存一键清理，任务/观察/制作/模板逐项二次确认删除，应用配置构成可导出报告 |
| 后台运行 | 已接入 | 采集、拆解、观察、制作等长任务由前台服务与 WakeLock 护持，熄屏或切后台继续推进；设置页提供主开关与电池优化引导 |
| 富迪素材库 | 已接入 | 观察、拆解、模板页头像左侧和制作页页头可离线打开随包宣传图；不是可运行的素材管理能力 |
| 发布 | 未接入 | 无路由；`features.publish=planned`。不伪造上传或发布结果 |

## 架构一览

```text
React UI（apps/web）
        ↓ 仅使用 AppRuntime 与版本化 DTO（含 replica）
Capacitor Runtime（packages/capacitor-runtime）
        ↓ 组合共享 Flow 与 Android I/O 端口
core + ai + platforms（共享 TypeScript 应用逻辑）
        ↓
Android 十个自定义插件 + @capacitor/app
        ↓
Keystore、私有文件、Photo Picker、受控网络、Media3（含 B 帧 remux）、TaskGuard 前台服务
```

- `core`、`ai`、`platforms` 不导入 Node、浏览器、Capacitor 或 Android API。
- Kotlin 只做系统 I/O；不复制 Prompt、Schema、平台解析、业务状态机或 UI 决策。
- 制作计划：文稿先行管线在本地组装并校验 `production-plan.v4` 后再交给 Media3；旧 v3 项目只读兼容。
- CLI 是开发期回归入口，不是 APK 的服务端或运行依赖。
- 详细规则见[架构与工程规范](docs/架构与工程规范.md)，源码树见[项目架构解析](docs/项目架构解析.md)，弹层与切页见[动效规范](docs/动效规范.md)，AI/开发任务规则见[AGENTS.md](AGENTS.md)。

## 环境与安装

- Node.js 22 或更高版本，推荐使用 Node.js 24；
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

CLI 图片回归由 `packages/node-runtime` 中精确锁定的 sharp 负责解码；该 Node 原生依赖不会进入 Web、Capacitor Runtime 或 Android APK。

## 构建 APK

Release 是本项目唯一 APK 构建与交付入口。项目不再生成、传递或保存 Debug APK。
构建成功后，版本化 Release APK 会自动保存在 `output/apk-archive/`，旧版本不会被新构建覆盖。

首次由签名材料保管人初始化仓库外签名身份，之后使用同一身份构建：

```powershell
.\scripts\init-android-release-signing.ps1
.\scripts\build-android-release.ps1
```

初始化只允许执行一次且拒绝覆盖已有身份。字段说明、备份责任、验签和升级操作见[Android 发布签名与升级指南](docs/Android发布签名与升级指南.md)。签名构建成功只证明主机候选的构建与身份校验通过，不等于全部发布门禁或物理真机通过；API 35 模拟器升级证据与相册/相机、网络、Media3 等剩余边界仍以[发布状态](docs/当前能力与发布状态.md)为准。

公开下载页的源文件是根目录 `download.html`（版本卡片由页内 `RELEASES` 数组驱动）；各版本字节数与 SHA-256 校验值见[当前能力与发布状态](docs/当前能力与发布状态.md)的版本谱系。

## 验证入口

```powershell
pnpm check
pnpm --filter @hongtai/web build
.\scripts\build-android-release.ps1
```

按改动类型选择完整验证，不以“能编译”代替真机或发布验收；见[任务执行模板](docs/任务执行模板.md)。

## 文档

- [文档索引与职责](docs/文档索引.md)
- [当前能力与发布状态](docs/当前能力与发布状态.md)
- [架构与工程规范](docs/架构与工程规范.md)
- [项目架构解析](docs/项目架构解析.md)
- [应用界面层数据对接清单](docs/前端显示板块对接清单.md)
- [错误码与应用界面通知约定](docs/错误码与前端通知约定.md)
- [AI应用能力层架构](docs/AI应用能力层架构.md)
- [任务执行模板](docs/任务执行模板.md)
- [Android 发布签名与升级指南](docs/Android发布签名与升级指南.md)
- [版本与发布流程](docs/版本与发布流程.md)
- [Android 旧系统 HEIF 兼容与依赖指南](docs/Android旧系统HEIF兼容与依赖指南.md)
