# v0.1.6 单次 AI 生成、深度思考展示与媒体选择恢复设计

> 日期：2026-08-13
> 状态：用户已选择方案 A；本文冻结实现边界，不代表代码、APK 或真机验收已经完成。

## 1. 任务契约

### 目标

- 舌诊、面诊和内容拆解的正常路径各只发起一次 AI 生成请求。
- 小米 MiMo 与阶跃星辰返回的真实推理流在生成页面以“深度思考”实时展示。
- 五个业务板块仍能从同一份结构化 JSON 中逐段完成，正式结果仍以最终完整校验和原子保存为准。
- 从 Android 系统视频选择器返回时不重载仍然健康的 WebView，不中断刚导入或其他正在运行的任务。
- 舌诊、面诊和本地视频主按钮在忙碌时保持绿色背景、黑色文字和禁止重复提交语义。

### 允许修改

- `packages/ai`：供应商推理方言、单次生成 Prompt/Schema/Flow、顶层 JSON 字段解析和进度聚合。
- `packages/core`：现有运行期进度 DTO 的可选深度思考投影。
- `packages/capacitor-runtime`：既有进度订阅、活动快照和 single-flight 的窄转发。
- `apps/web`：深度思考面板、五板块进度适配、媒体返回生命周期和忙碌按钮样式。
- 受影响测试、活文档、CHANGELOG、Android 版本与本次验收记录。

### 明确不做

- 不建设 Agent、工具调用循环、动态工作流、Prompt DSL、数据库、远程后端、WebSocket、轮询或后台服务。
- 不更换现有小米或阶跃默认模型 ID；模型升级必须另有真实能力和额度验证。
- 不把供应商推理写入报告、任务、运行审计、日志、模板、历史、截图夹具或 Git。
- 不让 React 页面解析 SSE、半截 JSON、供应商响应对象或私有媒体地址。
- 不迁移已有 `diagnosis-report.v1`、`content-analysis.v1` 正式文档。
- 不发布、上传、合并 `main` 或推送远端，直到新的物理设备门禁通过。

### 架构归属

- `packages/ai` 唯一负责 Provider 字段匹配、Prompt、模型输出 Schema、流式字段闭合、Zod/语义校验和最终文档组装。
- `packages/core` 只定义版本化、可序列化但仅运行期使用的 UI DTO。
- `packages/capacitor-runtime` 只转发并重放 `packages/ai` 已形成的进度快照，不复制解析器或 AI 状态机。
- `apps/web` 只按 DTO 渲染纯文本推理和已校验模块，不读取 Provider 原始流。
- Kotlin 继续只负责 Keystore、受控网络、私有文件和系统媒体选择，不新增 AI 或 UI 规则。

### 权威状态与数据

- `taskId`、`sessionId` 继续是对应运行的唯一业务 ID。
- 同一 ID 继续 single-flight；第二次调用加入既有 Promise 和事件源。
- 推理文本只存在于活动运行的内存快照，终态后清除；进程或 WebView 真正重建后不恢复推理文本。
- 正式结果只在完整 Schema 与跨字段语义校验通过并原子保存后成立。
- 系统选择器返回不等于进程重建；普通恢复事件不得主动销毁当前 WebView。

## 2. 选定方案

采用“一次请求 + 真实推理流 + 同一 JSON 的顶层字段流”方案。

不采用以下方案：

- 只显示推理、完整 JSON 结束后一次性展示：改动更少，但丢失原有五板块逐段反馈。
- 保留五次请求并显示每次推理：无法解决串行耗时、重复证据和上下文膨胀。
- 改用 NDJSON 或自定义事件协议：不再是一份标准 JSON，且偏离两个供应商已经支持的 JSON mode。

目标链路：

```text
图片或真实证据
  → 一次 Provider 流式请求
  → reasoning delta 形成运行期“深度思考”投影
  → content delta 进入 packages/ai 顶层字段解析器
  → 完整板块通过模块 Zod/语义校验后发送进度
  → 完整 JSON 通过最终文档校验
  → 原子保存
  → 发送终态并清除活动推理快照
```

## 3. 小米与阶跃推理协议

现有 Provider 已能读取 `reasoning` 与 `reasoning_content`，本次补全请求字段和公共运行期投影。

| 供应商 | 请求字段 | 首选流字段 | 兼容回退 |
| --- | --- | --- | --- |
| 小米 MiMo | `thinking: { type: "enabled" }` | `delta.reasoning_content` | `delta.reasoning` |
| 阶跃星辰 | `reasoning_format: "general"` | `delta.reasoning` | `delta.reasoning_content` |

规则：

- 根据仓库两个正式预设的规范化 Base URL 选择方言；未知高级配置保持通用兼容解析，不猜供应商专属请求参数。
- 小米显式开启深度思考，不依赖默认值。
- 阶跃使用原生 `reasoning`；不强制改成 DeepSeek 风格。
- 当前默认模型不统一发送 `reasoning_effort`。该字段的支持取决于具体阶跃模型版本，向不支持的模型发送会扩大 HTTP 400 风险。
- 输出上限使用请求级语义值，由 Provider 方言映射为小米 `max_completion_tokens` 或阶跃 `max_tokens`。
- 某个模型没有返回 reasoning 时，“深度思考”容器仍真实显示等待状态；请求结束后显示“当前模型未返回可展示的推理文本”，不伪造内容。

参考：

- [小米 MiMo 深度思考](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking)
- [小米 MiMo 结构化输出](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)
- [阶跃星辰推理模型最佳实践](https://platform.stepfun.com/docs/zh/guides/developer/reasoning)
- [阶跃星辰 Chat Completions API](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create)

## 4. 运行期进度契约

在未正式发布的 `structured-generation-progress.v1` 上增加一个可选字段，不再推进新的 AppRuntime 主版本：

```ts
interface StructuredGenerationThinkingV1 {
  readonly status: "waiting" | "streaming" | "completed";
  readonly text: string;
}

interface StructuredGenerationProgressV1 {
  readonly schemaVersion: "structured-generation-progress.v1";
  readonly flow: "diagnosis-report" | "content-analysis";
  readonly phase: "preparing" | "generating" | "validating" | "saving";
  readonly thinking?: StructuredGenerationThinkingV1;
  readonly modules: readonly StructuredGenerationModuleV1[];
}
```

推理投影规则：

- `reasoning_delta` 只追加纯文本，不传递供应商对象、字段名、请求头或模型配置。
- 更新在 `packages/ai` 合并后发送，避免每个 Token 触发一次 React 渲染；完成、失败和进入正文时必须刷新最后一段。
- Runtime 只在当前活动快照中保存累计文本，新订阅者可立即重放。
- 终态事件发送后清除活动快照。
- 推理内容不参与模块成功、报告成功、错误码或任何业务分支。
- 修复调用若发生，其推理继续追加到同一运行期面板，并以本地分隔文案标明“正在校正输出结构”。

这是对旧“reasoning 绝不进入 UI”规则的显式替换：允许的仅是当前运行期纯文本投影，仍禁止持久化和把它当成正式结论。

## 5. 单次诊察生成

模型侧使用一个紧凑对象：

```json
{
  "quality": "good",
  "observation": "当前图片中可以直接看到的特征。",
  "summary": "对可见信息的简要归纳。",
  "advice": "基于可见信息的日常记录建议。",
  "safety": "图片观察的限制和需要进一步咨询的情况。",
  "followUp": "近期作息或饮食是否有明显变化？"
}
```

约束：

- `quality` 仅允许 `good | limited | unusable`，其余字段是有界字符串。
- 模型不生成 `schemaVersion`、`mode`、`promptVersion`、报告 ID、观察 ID、类别 ID 或固定免责声明。
- 图片只随这一次视觉请求发送。
- 应用本地把紧凑结果确定性组装为 `diagnosis-report.v1`，旧报告继续可读。
- `quality=unusable` 时本地语义校验禁止无依据状态参考或建议，只允许重拍、安全限制和必要追问。
- 新报告使用新的单次生成 Prompt 版本；旧 `diagnosis-initial.v1` 与 `diagnosis-modular.v1` 仍可读取。

五个 UI 板块映射为：

1. `quality + observation`；
2. `summary`；
3. `advice`；
4. `safety`；
5. `followUp`。

## 6. 单次内容拆解

- 完整真实证据只发送一次。
- 模型输出一个含五个顶层板块的对象：`overview`、`hookDrivers`、`structureClaims`、`styleTemplate`、`risksBoundaries`。
- `schemaVersion` 与 `source` 全部由应用本地注入。
- 必要 `evidenceRefs` 继续保留并逐板块校验，不能为缩短 JSON 而牺牲证据真实性或下游模板/制作能力。
- 通过本地组装继续保存为 `content-analysis.v1`，不迁移模板和制作页面。

## 7. 顶层 JSON 字段解析器

新增一个仅供上述两个 Flow 使用的小型解析器，职责严格限定为：

- 识别最外层对象和白名单顶层属性；
- 正确处理字符串、转义、中文跨 chunk、嵌套对象与数组；
- 仅在属性值完整闭合后返回可 `JSON.parse` 的值；
- 不修复 JSON、不猜字段、不使用正则从半截 JSON 中取值；
- 模块 Zod 与语义校验通过后才发送 `succeeded` 进度。

完整流结束后仍重新解析整个响应并执行最终 Schema。正常路径一次调用；完整结果无效时最多进行一次整份修复，最大两次调用，不再为五个模块分别修复。

## 8. UI 行为

共享 `DeepThinkingPanel` 放在现有 `ValidatedModuleProgress` 顶部：

- 请求开始即显示“深度思考”和流光等待；
- 第一个推理 delta 到达后默认展开，纯文本实时追加；
- 推理结束并进入正文后自动折叠，用户可重新展开；
- 固定最大高度和内部滚动，约 390px 移动端不横向溢出；
- 不解析 Markdown，不使用 `dangerouslySetInnerHTML`；
- `aria-live="polite"` 只播报状态变化，不朗读每个 Token；
- `prefers-reduced-motion` 下关闭流光和位移动画；
- 明示“实时思考尚未经过报告校验，不代表正式结论”。

五板块继续使用现有流光、校验和渐显组件；正式完成后仍重新读取持久化记录，不直接把内存结果当正式文档。

## 9. Android 媒体选择恢复

- 普通 `inactive → active` 只广播应用恢复和重读信号，不调用 `window.location.reload()`。
- 外部 Photo Picker/相机回调继续在原 WebView 中完成，刚导入的本地视频继续 `queued → running`。
- 真正的 WebView 或进程重建自然重新执行启动入口，再由现有幂等恢复逻辑把遗留工作写为明确终态。
- `inspectUnfinishedWork()` 不再决定普通前台恢复是否销毁 WebView。
- 检查失败显示稳定读取错误，不以 reload 作为兜底。
- 不增加延时、轮询或第二套生命周期状态机。

## 10. 忙碌按钮

- 保留原生 `disabled`，继续防止重复提交。
- 诊察生成和本地视频选择按钮在忙碌时使用定向 `button--busy-primary`：绿色背景、黑色文字、`aria-busy=true`。
- 不全局改变其他真正不可用按钮的灰色禁用语义。

## 11. 错误、恢复与清理

- 正文开始但没有 reasoning：继续生成，面板如实显示无推理文本。
- 推理存在但最终 JSON 无效：保留当前页面推理与已验证模块，进入一次整份修复；正式文件仍不存在。
- 修复失败：发送稳定 `AI_FORMAT_REPAIR_FAILED`，不调用第三次，不保存半成品。
- 路由离开或监听器抛错：Flow 继续完成；重新进入可重放活动快照。
- WebView/进程丢失：推理文本丢弃，正式运行按既有中断恢复进入明确终态。
- 清理五次模块 Prompt、模块级 repair 调用、重复证据拼接和“必须调用五次”的测试残余；保留 Provider SSE、single-flight、正式 Schema 和原子保存。

## 12. 测试与验收

### 定向测试

- 小米请求发送 `thinking.type=enabled`，解析 `reasoning_content` 并兼容 `reasoning`。
- 阶跃请求发送 `reasoning_format=general`，解析 `reasoning` 并兼容 `reasoning_content`。
- 正常舌诊、面诊、内容拆解各恰好一次 Provider 调用。
- 整份修复路径总调用数恰好两次，失败后不再调用。
- 图片和内容证据各只发送一次。
- 推理进入活动 DTO，但不进入任何持久化 JSON、日志或正式结果。
- 顶层字段解析覆盖中文、转义引号、字段名跨 chunk、嵌套数组/对象和非白名单字段。
- 系统选择器返回时 reload 次数为 0，视频任务和其他运行任务不中断。
- 真正重新启动时既有幂等恢复仍生效。
- 忙碌按钮仍 disabled，但背景绿色、文字黑色。

### 工程门禁

- 受影响定向测试与 `pnpm check`。
- `pnpm --filter @hongtai/web build`。
- 桌面和约 390px 的深度思考面板与按钮检查。
- `git diff --check`、严格 UTF-8/U+FFFD 和敏感信息扫描。
- Android Release 单测、lint、构建和 API 35 模拟器回归。
- 物理设备完成相册返回、真实小米/阶跃推理、一次请求、自动状态更新和正常升级验证后，才允许继续正式发布。

## 13. 提交与版本

实施按以下本地提交边界推进：

1. `fix(runtime): keep media imports alive across picker return`
2. `refactor(ai): generate reports in one reasoning stream`
3. `feat(web): render live provider reasoning`
4. `refactor: remove five-call generation residue`
5. `chore(release): prepare v0.1.6 code 14`

当前 v0.1.6/code13 候选已被物理端测否决，不得上传、切换下载页、合并 `main` 或推送。修复候选保持 `versionName=0.1.6`，推进到 `versionCode=14`，重新生成来源提交、APK 哈希和验收证据。

## 14. 设计自检结论

- 没有占位内容或未决供应商字段。
- UI 五板块与一次 Provider 调用不再混为同一概念。
- 推理可见与正式结果校验边界明确分开。
- 两条 Flow 共用的抽象只有推理快照和顶层字段解析器，均有两个真实调用点。
- 没有新增持久化、后台能力、通用编排或无真实调用点的框架。
