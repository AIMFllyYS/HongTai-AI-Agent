# 宏泰 AI Agent：仓库执行规则

> 本文件是仓库级、长期有效的执行约束。当前能力、发布成熟度和修复队列见
> [`docs/当前能力与发布状态.md`](docs/当前能力与发布状态.md)；详细架构契约见
> [`docs/架构与工程规范.md`](docs/架构与工程规范.md)。二者不应复制到本文件。

## 开始任务前

- 先读本文件、当前能力状态，以及受影响目录的测试和相邻文档。
- 先判定任务归属：UI、共享应用逻辑、平台解析、AI Flow、Capacitor 组合层或 Android I/O。
- 纯分析、审查或状态查询保持只读；发现超出范围的问题，建立独立 Issue，不顺手扩写。
- 文档、代码和测试冲突时，不得猜测。说明冲突、选择最小安全路径，并在同一任务中更新活文档或登记 Issue。

## 项目与分层

这是本地优先的 Android APK，不是传统远程前后端系统：

- `apps/web` 是 React 应用界面层；页面只使用 `AppRuntime` 和版本化 DTO。
- `packages/core` 是领域模型、任务契约和业务规则。
- `packages/ai` 是 AI Provider、Prompt、Schema、Flow 与安全规则。
- `packages/platforms` 只做公开链接识别、规范化与解析。
- `packages/capacitor-runtime` 只组合共享 Flow 与 Android I/O 端口。
- `android/app` 只做 Keystore、私有文件、系统媒体选择、受控网络与必要媒体 I/O。
- `apps/cli` 与 `packages/node-runtime` 仅用于开发回归，不能成为 APK 的隐式运行依赖。

硬规则：

1. `core`、`ai`、`platforms` 不得导入 Node、浏览器、Capacitor 或 Android API。
2. 不在 Capacitor 或 Kotlin 复制 Pipeline、状态机、平台解析、Prompt 或 Schema。
3. UI 不得读取私有路径、原始平台响应、Cookie、请求头、API Key 或供应商 reasoning。
4. Kotlin 不得决定业务流程、UI 文案或医疗/平台业务规则。
5. 不新增未获授权的云端后端、登录、同步、数据库、后台服务或泛化框架。

## 文件、组件与复用

- 一个文件只承担一个清晰职责；优先短而完整的模块，不建立仅转发的 re-export 壳。
- 没有机械行数上限，但文件开始同时承担三个以上无关职责，或约 300 行后难以独立测试时，应按职责拆分。
- 修改前先搜索现有组件、DTO、Schema、错误码、存储 helper 和 Flow；复用稳定实现，不复制逻辑或另造轮子。
- 共享抽象必须有至少两个真实调用点或明确的跨层契约；单次使用保持局部，避免为了“可复用”而过度设计。
- UI 优先组合既有组件和 design token；视觉变更不得破坏可访问性、移动端布局或真实数据边界。

## 状态、生命周期与数据

- 每个 `taskId`、`sessionId`、`projectId` 只能有一个权威状态源；并发写入必须 single-flight、串行化或使用版本校验。
- 外部 Activity、进程重建、失败、取消和重试必须进入明确终态或可解释恢复态；不得永久显示“进行中”。
- 图片导入、下载、解码、压缩、渲染等重 I/O 不得阻塞 Android 主线程。
- 文件先写临时位置再替换；失败不得删除已有成功产物或伪造成功状态。
- UI 只按稳定 `TaskIssue.code` 和 `action` 分支，不能解析中文异常、HTTP 文案或 DOM 文案。

## 安全与真实性

- 禁止假上传、假进度、假诊察、假生成、假发布或把 fixture 当真实结果。
- 不在代码、日志、Issue、测试快照、截图或 Git 写入 API Key、Cookie、Token、Authorization、签名 URL、完整敏感查询参数、base64 媒体或供应商 reasoning。
- 继续使用最小系统权限。不要以新增宽泛相册/相机权限、放宽 TLS 校验或关闭安全检查来掩盖问题。
- 图片观察只提供日常观察参考；不得输出疾病诊断、处方、概率或整体健康评分。

## 文档与任务契约

- README 是入口，不复制实现细节；活文档、历史证据与计划的职责见 [`docs/文档索引.md`](docs/文档索引.md)。
- 文档过长或面对不同读者时，按“规则、状态、操作指南、历史证据”拆分；使用链接，不复制大段内容。
- 每个实现任务使用 [`docs/任务执行模板.md`](docs/任务执行模板.md) 说明范围、非目标、状态权威来源和验收证据。

## 验证与 Git

- 所有源代码、文档、资源清单和 JSON 保持 UTF-8；不得引入 U+FFFD 或错误编码的中文。
- TypeScript 变更至少运行定向测试与 `pnpm check`；Web 变更还运行 `pnpm --filter @hongtai/web build`，视觉变更做桌面和约 390px 移动端检查。
- Android 变更运行相关 Gradle 测试/lint/build；涉及相册、相机、外部 Activity、网络或 Media3 时，未经真机验证不得声称真机通过。
- 发布前额外验证 release 签名、递增 `versionCode`、APK SHA-256 与不带降级参数的正常升级路径。
- 保留不相关的工作区改动与本地数据；精确暂存，禁止默认 `git add .`、硬重置或广泛删除。
- 每个完成的源码或文档阶段都在验证后本地 commit；未经用户明确授权不得推送。

## Code Review Rules

- 只报告可复现、由本次变更引入、且作者应修复的问题。
- 优先检查跨层越界、并发覆盖、生命周期丢失、密钥泄露、真实性与数据丢失。
- 将格式化和通用 lint 交给 CI；行级反馈要说明触发条件与最小修复方向。
