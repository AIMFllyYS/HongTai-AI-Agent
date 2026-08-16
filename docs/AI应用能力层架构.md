# 宏泰 AI 应用能力层架构

> 本文说明已接入的 AI Flow 与视频制作的归属。分层、安全、状态和验收以[架构与工程规范](架构与工程规范.md)为准；能力成熟度以[当前能力与发布状态](当前能力与发布状态.md)为准。

## `packages/ai` 拥有的 Flow

| Flow | 输入 | 输出 | 启动方式 |
| --- | --- | --- | --- |
| `ContentAnalysisFlow` | 成功任务的真实转写 segment 或图文 paragraph | `content-analysis.v1` 与可追溯证据 | 用户确认后显式启动 |
| `DiagnosisFlow` | 已导入私有图片与舌象/面部单模式 | `diagnosis-report.v1`、追问历史 | 用户创建会话 |
| `ProductionPlanningFlow` | `content-analysis.v1`、来源文稿、用户导入素材与目标时长 | `production-plan.v2` | 用户创建或更新视频项目 |
| `createAvatarCaptionPlan` | 用户口播稿与带原声的素材 | `production-plan.v2` | 数字人口播模式，**不调用模型** |

上下游的两个环节不属于本层，列在这里只为说明衔接关系：

| 环节 | 归属 | 输入 | 输出 |
| --- | --- | --- | --- |
| `IngestPipeline` | `packages/core` | 公开分享文案中的单条链接，或本机 MP4 | 七阶段事件、媒体、正文、转写、任务产物 |
| Media3 执行 | `android/app` | 已通过共享 TypeScript 校验的 `production-plan.v2`（兼容读取 v1）与项目私有素材 | 本地竖屏 MP4 |

发布没有对应 Flow，保持 `planned`。富迪素材库是底部导航中的离线静态图片入口，同样不涉及 AI Flow。任何情况下都不得以示例计划、静态素材或模拟进度替代真实结果。

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

AI 与平台业务逻辑只在共享 TypeScript 层存在一次。Capacitor/Kotlin 通过端口提供私有图片读取、文件保存、受控网络和媒体执行，不能复制 Prompt、Zod Schema、平台解析或制作计划规则。页面只调用 `AppRuntime.analysis`、`diagnosis`、`production`，不读取原始供应商响应对象；运行期推理文本也只能来自版本化进度 DTO。

## OpenAI 兼容与结构化输出

- 连接显式配置 Base URL、API Key、文本/视觉/ASR 模型与必要格式开关。设置页提供小米 MiMo 与阶跃星辰固定预设，供应商差异只在 Provider 边界映射；高级自定义连接继续使用通用 OpenAI 兼容路径。
- 文本、视觉、ASR 独立探测和调用；一项成功不表示其他能力可用。
- Zod 是正式结果的唯一业务契约。Provider JSON Schema、JSON Object 和 Prompt-only 是传输降级策略，不能替代运行时校验。
- 内容拆解与首次图片观察在正常路径各进行一次结构化流式调用，不把展示板块变成五次网络请求。内容拆解的紧凑响应是五个顶层字段，与五个展示板块一一对应；图片观察的紧凑响应是八个顶层字段，由组装层按字段组合成五个展示板块。
- 视频规划不在流式进度总线上：它是一次生成加最多一次修复，不产生 `structured-generation-progress.v1`，制作进度来自 Android 渲染事件。
- 顶层字段组完整闭合并通过板块 Zod 与语义校验后才能进入公共进度；完整文档解析失败时最多进行一次受控格式修复，仍失败则返回稳定错误，不臆造字段。
- 小米 MiMo 使用 `reasoning_content`，阶跃星辰使用 `reasoning`；Provider 将增量统一投影为运行期 `thinking` DTO。推理文本可以在当前页面的“深度思考”中展示，但不进入正式报告、后续对话、本地运行审计、日志或 Git。

## 证据与安全边界

- 内容拆解只能从真实转写或图文段落得出核心结论。完全没有证据单元时直接以 `TASK_ARTIFACT_MISSING` 失败并提示用户，不生成空壳文档；证据存在但某个板块无内容时允许该板块为空数组。
- 图片观察只提供可见观察、日常参考、建议、安全提示和局限；不得输出疾病诊断、处方、概率或综合健康评分。正式 Schema 中不存在健康评分、处方或概率字段，组装层强制 `notADiagnosis` 与固定免责声明。
- 视频制作计划只引用当前项目已导入的素材 ID；TypeScript 验证计划后 Kotlin 才能执行。Kotlin 侧的解析器只做 Media3 执行前的数值与枚举防御，业务规则以本层的 `validatePlan` 为准。
- 当前视频项目仍需处理并发写入、渲染中断、原生异常和本地存储预算；对应问题以 GitHub P1/P2 Issue 为准，不在文档中假定已修复。

## 开发期 CLI

- `pnpm cli diagnosis serve`：仅绑定 `127.0.0.1` 的本地图片观察回归入口。
- `pnpm cli analyze-content <task-id>`：对已有 CLI 任务运行内容拆解。
- CLI 产物位于 `workspace/`，与 APK 私有目录是同一业务契约的不同适配，不是 UI 数据源。

命令、产物和人工回归细节见[CLI运行与产物说明](CLI运行与产物说明.md)。
