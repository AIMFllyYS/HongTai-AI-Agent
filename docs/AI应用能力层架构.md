# 宏泰 AI 应用能力层架构

> 本文说明已接入的 AI Flow 与视频制作的归属。分层、安全、状态和验收以[架构与工程规范](架构与工程规范.md)为准；能力成熟度以[当前能力与发布状态](当前能力与发布状态.md)为准。

## 已接入的业务 Flow

| Flow | 输入 | 输出 | 启动方式 |
| --- | --- | --- | --- |
| `IngestPipeline` | 公开分享文案中的单条链接 | 七阶段事件、媒体、正文、转写、任务产物 | 用户创建任务 |
| `ContentAnalysisFlow` | 成功任务的真实转写 segment 或图文 paragraph | `content-analysis.v1` 与可追溯证据 | 用户确认后显式启动 |
| `DiagnosisFlow` | 已导入私有图片与舌象/面部单模式 | `diagnosis-report.v1`、追问历史 | 用户创建会话 |
| `ProductionPlanningFlow` | `content-analysis.v1`、用户导入素材与目标时长 | `production-plan.v1` | 用户创建或更新视频项目 |
| Media3 执行 | 已验证的 `production-plan.v1` 与项目私有素材 | 本地竖屏 MP4 | 用户显式渲染 |

素材库和发布没有对应 Flow，保持 `planned`；不得以示例计划、静态素材或模拟进度替代真实结果。

## 代码边界

```text
apps/cli                    开发期命令与本地回归入口
packages/core               领域模型、任务/项目 DTO、错误契约
packages/platforms          公开平台链接解析
packages/ai                 Provider、Prompt、Schema 与业务 Flow
packages/node-runtime       CLI 的文件、下载和图片预处理适配
packages/capacitor-runtime  APK AppRuntime、私有仓储与端口组合
android/app                 Keystore、私有文件、媒体选择、HTTP、Media3
```

AI 与平台业务逻辑只在共享 TypeScript 层存在一次。Capacitor/Kotlin 通过端口提供私有图片读取、文件保存、受控网络和媒体执行，不能复制 Prompt、Zod Schema、平台解析或制作计划规则。页面只调用 `AppRuntime.analysis`、`diagnosis`、`production`，不读取原始供应商响应。

## OpenAI 兼容与结构化输出

- 连接显式配置 Base URL、API Key、文本/视觉/ASR 模型与必要格式开关；不内置供应商。
- 文本、视觉、ASR 独立探测和调用；一项成功不表示其他能力可用。
- Zod 是正式结果的唯一业务契约。Provider JSON Schema、JSON Object 和 Prompt-only 是传输降级策略，不能替代运行时校验。
- 结构化输出解析失败时最多进行一次受控格式修复；仍失败则返回稳定错误，不臆造字段。
- 供应商 reasoning 只允许进入受控开发调试材料，不进入正式报告、UI、后续对话或 Git。

## 证据与安全边界

- 内容拆解只能从真实转写或图文段落得出核心结论；证据不足时返回诚实空结果。
- 图片观察只提供可见观察、日常参考、建议、安全提示和局限；不得输出疾病诊断、处方、概率或综合健康评分。
- 视频制作计划只引用当前项目已导入的素材 ID；TypeScript 验证计划后 Kotlin 才能执行。
- 当前视频项目仍需处理并发写入、渲染中断、原生异常和本地存储预算；对应问题以 GitHub P1/P2 Issue 为准，不在文档中假定已修复。

## 开发期 CLI

- `pnpm cli diagnosis serve`：仅绑定 `127.0.0.1` 的本地图片观察回归入口。
- `pnpm cli analyze-content <task-id>`：对已有 CLI 任务运行内容拆解。
- CLI 产物位于 `workspace/`，与 APK 私有目录是同一业务契约的不同适配，不是 UI 数据源。

命令、产物和人工回归细节见[CLI运行与产物说明](CLI运行与产物说明.md)。
