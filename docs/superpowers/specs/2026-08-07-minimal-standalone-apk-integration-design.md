# 最小独立 APK 对接设计

## 目标

交付一个可安装的 Android APK。用户可以在应用内保存一个 OpenAI 兼容连接、粘贴公开作品分享文本、看到既有七阶段任务的真实状态和产物、手动运行既有内容拆解，并完成一次舌象或面部图片观察及追问。

本设计中的“应用界面层”是 `apps/web`；“本地应用逻辑层”是 `packages/core`、`packages/platforms` 与 `packages/ai`；Kotlin 只承担 Android 系统 I/O。项目没有远程 Web 后端。

## 已批准的约束

- APK 必须独立运行，不能把 Node CLI 当作 APK 的服务端或隐式依赖。
- 既有 `IngestPipeline`、平台解析器、`ContentAnalysisFlow` 和 `DiagnosisFlow` 是唯一业务逻辑来源；不得在 Capacitor 或 Kotlin 中复制七阶段、平台规则、Prompt 或 Schema。
- 首版是 Demo：优先一条真实可验证链路，不预建生产级账号、云同步、多供应商、多进程恢复、后台续跑、复杂迁移或泛化插件体系。
- `.env` 只用于开发机 CLI 回归；APK 内的 API Key 只写入 Android Keystore 保护的槽位，React 永不读取完整值。
- 不展示任何伪任务、伪指标、伪上传、伪生成或伪医疗结论。

## 最小架构

```text
React 页面
  -> ThinAppRuntime（版本化 DTO、页面状态）
  -> 共享 TypeScript Flow（既有 Pipeline / AI Flow / 平台解析）
  -> 4 个具名 Android 能力端口
       SecureSettings: API Key
       LocalFiles: 私有文件、任务索引、图片导入
       NativeHttp: 文本请求、媒体下载、AI 请求
       MediaTools: 仅在共享 Flow 确认需要时执行媒体探测/抽音频
  -> Android 私有目录、Keystore、网络、Photo Picker
```

`ThinAppRuntime` 只组合现有 Flow，不再维护第二个任务执行器。每个任务的真实状态、事件和产物写入应用私有目录：`tasks/<taskId>/task.json`、`events.jsonl` 和既有产物文件。任务列表只读取一个小的 `tasks/index.json`。这不是数据库抽象，也不引入迁移框架；文件写入采用临时文件后原子替换，保证中途失败不会伪造成功记录。

## 公共数据边界

页面只获得四类安全 DTO：

```ts
type TaskSnapshotV1 = { taskId; status; currentStage?; analysisStatus; createdAt; updatedAt; summary? };
type TaskEventV1 = { taskId; sequence; stage?; status; message; timestamp; issue? };
type TaskArtifactsV1 = { content; media; transcript; analysis? };
type ObservationSessionV1 = { sessionId; mode; report; messages };
```

内部文件路径、`content://` URI、下载请求头、Cookie、签名 URL、供应商原始响应、reasoning 和完整 API Key 不会离开适配层。UI 只使用转换过的展示 URI 和稳定错误码。

## 行为设计

### URL 任务

1. 页面调用既有 `inspectInput(rawText)` 显示首个支持链接、平台与实验性提示。
2. 用户确认后，运行时创建任务目录和初始快照。
3. 运行时用 Android 端口实现 `IngestPipeline` 所需的 HTTP、下载、文件和媒体依赖；既有 Pipeline 依次产生七阶段事件。
4. 每个真实事件先写 `events.jsonl`，再通知 UI；最终产物由既有逻辑写入任务目录。
5. 任务详情、处理页和历史页只读取这些真实文件。内容拆解由用户点击触发，使用既有 `ContentAnalysisFlow`，其结果写入任务目录中的正式 JSON。

首版不实现后台续跑、取消、自动重试或第二份 `TaskStatus` 状态机。若用户离开页面，任务可继续在前台进程内完成；进程结束时，下次启动把未终态任务明确标为 `interrupted`，由用户重新发起新任务。

### 设置与档案

显示名、门店信息、模型名称和 Base URL 用 Android 私有偏好保存；API Key 单独用 Keystore 保护。设置页只显示“已配置”和更新时间。首版保留一个“连接测试”入口，按实际即将使用的能力测试，不建立通用探测矩阵。

### 图片观察

页面一次只能选择舌象或面部。Photo Picker 返回的图片先复制到私有目录；共享 `DiagnosisFlow` 通过 `AiTransport` 请求视觉模型并将报告与追问历史写入会话目录。Kotlin 不解释报告内容；UI 只渲染既有 `diagnosis-report.v1`。

## 明确不做

- SQLCipher 任务/分析/诊断多表、数据库迁移和数据库恢复；
- 通用任务执行器、第二份七阶段 Runner、自动恢复、后台续跑、前台服务通知；
- 多账号、云同步、远程 API、多个连接档案；
- 在 Kotlin 重写平台解析、Prompt、Zod Schema 或内容拆解；
- 制作、素材、发布的假功能。

这些能力在真实需求出现并有真机证据证明缺口后，才作为独立纵向功能增加。

## 验收标准

1. Android debug APK 可从干净构建安装，启动后不依赖 `.env`。
2. 设置页能保存公开配置与 Key 状态，完整 Key 不出现在 React、日志或构建产物。
3. 用一个公开支持链接创建任务，页面显示来自既有 Pipeline 的七阶段真实事件和真实成功/失败结果。
4. 任务详情显示实际产物；无数据时显示空态。
5. 用户确认后可生成并显示真实内容拆解。
6. 可从相册选择一张图片，得到一次真实观察报告并完成一次追问。
7. 制作、素材、发布仍只显示“尚未接入”。

## 维护规则

- 一个业务规则只存在于一个共享 Flow；一个任务只有一个快照和一个事件日志。
- 新功能先证明一个真实用户路径，再抽象；不能为“未来可能需要”增加表、状态、插件或框架。
- 函数和组件按单一职责命名：`readTaskSnapshot`、`appendTaskEvent`、`renderTaskStatus` 等，不使用含糊的 `handleData`、`processAll`。
- 每个纵向阶段仅暂存对应路径，运行定向测试、`git diff --cached --check` 和 UTF-8 扫描后本地提交；不自动推送。
