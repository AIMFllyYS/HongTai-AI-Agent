# Android 生命周期中断与最小权限设计

> 日期：2026-08-12
> 状态：已按无人值守授权完成方案比较与自审；本设计只覆盖当前 APK 的可靠降级和权限真实性，不宣称已经获得跨进程后台续跑能力。

## 1. 目标

解决两个相互关联、但不能混为一谈的问题：

1. 当应用切到后台、WebView 被暂停或进程被系统回收后，任何已经失去执行器的工作都不能永久显示为“运行中”；再次进入应用时必须从唯一持久状态源得到明确的异常中断终态，并保留已有产物。
2. 解释并锁定当前拍照/相册路径的最小权限事实：应用调用系统相机并向其临时授予一个私有输出 URI，图片选择使用 Photo Picker 或 `ACTION_OPEN_DOCUMENT`，因此当前不应声明 `CAMERA`、`READ_MEDIA_IMAGES` 或宽泛存储权限。

本阶段优先交付可验证、不会复制业务流程的生命周期降级。真正后台执行作为后续独立能力，按原生工作单元渐进实现。

## 2. 当前事实与根因

### 2.1 执行位置

当前运行链路为：

```text
React 页面
  → AppRuntime
  → packages/capacitor-runtime 中的共享 TypeScript Flow 组合
  → Kotlin 具名 I/O 插件
```

`IngestPipeline`、`ContentAnalysisFlow`、`DiagnosisFlow` 和 `ProductionPlanningFlow` 都由前台 WebView 的 JavaScript 驱动。Kotlin 只承担网络、私有文件、图片导入和 Media3 渲染等 I/O。`FLAG_KEEP_SCREEN_ON` 只能阻止 Activity 可见时自动熄屏，不能保证后台 WebView 继续执行，也不能在进程死亡后恢复 Promise。

### 2.2 恢复缺口

- URL 采集只有一次冷启动扫描：`running` 快照会变为 `interrupted`。
- 内容拆解的 `analysisStatus=running`、观察报告的 `reportStatus=running`、制作项目的 `planning` / `rendering` 没有冷启动恢复。
- 应用没有监听 Capacitor `appStateChange` / `resume`。
- 页面只在首次挂载读取持久状态；进程内订阅不能代替从后台返回后的重新对账。
- 因此，WebView 或 Bridge 调用一旦停在未决 Promise，页面和文件中的运行态都可能永久存在。

### 2.3 权限事实

当前拍照实现使用 `MediaStore.ACTION_IMAGE_CAPTURE` 启动系统相机应用，并通过 `FileProvider` 将单个暂存 URI 以 `FLAG_GRANT_READ_URI_PERMISSION | FLAG_GRANT_WRITE_URI_PERMISSION` 临时授予该相机应用。相册使用 Android 13+ Photo Picker，旧系统回退到 `ACTION_OPEN_DOCUMENT`。

这两条路径都不要求本应用直接持有相机或整个相册的危险权限。Manifest 中的 `INTERNET` 是普通权限，不会产生相机/相册运行时授权弹窗；Android 系统设置因此可能显示“无权限”或没有可管理的危险权限分组。这是最小权限结果，不是功能缺失。

只有未来把拍照改为应用内 CameraX 预览时，才应在功能触发点声明并申请 `CAMERA`，处理说明、拒绝、永久拒绝和跳转系统设置；不能为了让系统设置出现“权限”板块而提前申请。

## 3. 方案比较

### 方案 A：继续依赖前台 WebView，只增加常亮或电池白名单提示

优点是改动最小。缺点是 Android 不保证后台 Activity/WebView 获得 CPU、网络或进程存活；电池白名单也不能成为业务正确性前提。该方案无法消除永久运行态，不采用。

### 方案 B：立即把整条流程迁入 WorkManager 或 Android 前台服务

前台服务可以在用户切换应用后提高进程优先级，并通过常驻通知让用户知情；WorkManager 适合可延迟、可重试的持久工作，用户发起的大文件传输还可使用 Android 14+ user-initiated data transfer job。

但当前业务状态机和 AI Flow 位于共享 TypeScript。直接在 Kotlin 重写七阶段、Prompt、Schema、重试和终态会形成第二套执行器，违反仓库分层；直接依赖 WebView 在前台服务进程中继续运行也没有平台保证。该方案必须先引入版本化 checkpoint、幂等步骤、执行租约、通知语义和跨进程结果收据，不能在本次作为快速补丁实施。

### 方案 C：统一生命周期对账与异常中断，后台能力按原生单元演进

本阶段新增一个 `AppRuntime.recovery` 服务，统一识别内存中的活动操作和持久化中的未终态工作。冷启动时原子地把所有失去执行器的工作转换为稳定终态；从后台返回时，如果同一 WebView 仍有不保证可继续的操作，则重建 WebView 运行时，让新的唯一执行器执行冷启动恢复；若没有未终态工作，只通知页面重新读取持久状态。

该方案不伪造后台续跑，不自动重试，不覆盖旧产物，不在 Kotlin 复制业务 Flow。它满足“无法继续时明确提示异常中断”的产品要求，并为后续把 Media3 和大文件传输迁入原生后台 API 保留边界。采用该方案。

## 4. 设计

### 4.1 AppRuntime 恢复契约

在 `packages/core` 增加版本化的恢复投影：

```ts
type RuntimeWorkKind =
  | "ingest"
  | "content-analysis"
  | "diagnosis-report"
  | "production-plan"
  | "production-render"
  | "transient-operation";

interface RuntimeUnfinishedWork {
  readonly kind: RuntimeWorkKind;
  readonly id: string;
  readonly source: "memory" | "persisted";
  readonly execution: "in-process" | "external-activity";
}

interface RuntimeRecoveryProjection {
  readonly unfinished: readonly RuntimeUnfinishedWork[];
  readonly recovered: readonly RuntimeUnfinishedWork[];
}

interface RuntimeRecoveryService {
  inspectUnfinishedWork(): Promise<readonly RuntimeUnfinishedWork[]>;
  recoverInterruptedWork(): Promise<RuntimeRecoveryProjection>;
}
```

持久化未终态均视为已经失去原执行器的 `in-process` 工作；内存登记则能区分普通进程内操作和系统外部 Activity。`AppRuntime` 只增加一个 `recovery` 入口；页面仍不得直接读取原生插件或私有文件。

### 4.2 各状态源的终态映射

| 权威状态源 | 未终态 | 恢复终态 | 用户问题 |
| --- | --- | --- | --- |
| `tasks/<taskId>/task.json` | `running` | `interrupted` | `TASK_INTERRUPTED`，`edit_input` |
| `tasks/<taskId>/analysis.json` 与任务投影 | `running` | `failed` | `TASK_INTERRUPTED`，`retry` |
| `observations/<sessionId>/session.json` | `reportStatus=running` | `reportStatus=failed` | `TASK_INTERRUPTED`，`retry` |
| `productions/<projectId>/project.json` | `planning` | `failed` | `TASK_INTERRUPTED`，`retry` |
| 同上 | `rendering` | `failed` | `TASK_INTERRUPTED`，`retry` |

恢复满足以下规则：

- 只修改未终态记录，重复执行是幂等的，不重复追加相同问题。
- 保留已经写入的媒体、正文、分析、计划、素材和临时/成功产物，不做清理或自动覆盖。
- 不自动恢复、不自动新建任务、不自动重试 AI 或网络请求。
- 每个服务仍写自己的唯一状态源；统一恢复服务只组合这些服务，不另建状态机。
- 某一类记录损坏或读取失败时，其他可恢复记录仍继续处理；错误通过已有稳定问题边界呈现，不吞掉全部恢复。

### 4.3 内存活动操作登记

仅扫描文件无法识别尚未落盘的 AI 探测、追问或桥接调用。Capacitor Runtime 内部增加轻量 `RuntimeOperationRegistry`：

- `in-process`：必须由当前 WebView 驱动的操作，如采集、内容拆解、观察报告、追问、制作计划、渲染等待和 AI 探测。
- `external-activity`：系统相机、Photo Picker、文档/素材选择器。它们会正常触发应用失活，但已有专用 Activity-result/照片恢复语义，不能因为打开系统界面就立刻判定失败。

登记只存在内存，不成为业务权威状态。进程死亡后仍以持久状态扫描为准。

### 4.4 前后台事件

使用官方 `@capacitor/app`：

1. Runtime 完成构造后，应用首次渲染前调用 `recoverInterruptedWork()`。
2. 监听 `appStateChange`，只在确实经历过 `isActive=false → true` 后处理返回前台。
3. 若只有 `external-activity` 操作，保留当前 WebView，让相机/选择器自己的恢复链路完成。
4. 若存在 `in-process` 活动操作或持久化未终态记录，调用受控的页面重载。旧 JS 执行器随页面销毁，新 Runtime 冷启动后统一落为中断终态，避免旧 Promise 晚到后覆盖恢复结果。
5. 若没有未终态工作，派发应用内 `hongtai:app-resumed` 事件；展示实时状态的页面重新读取持久化 DTO，不根据旧 React state 猜测结果。

浏览器开发环境使用 `visibilitychange` 等价实现，不调用 Android 私有 API。

### 4.5 页面行为

- 采集页重新读取任务和事件；`interrupted` 使用现有中断卡片和“重新提交链接”。
- 内容拆解页、观察报告页和制作页从其权威文件重读 `failed + TASK_INTERRUPTED`，展示统一 `IssueNotice`。
- 没有持久运行态的临时操作在 WebView 重建后清除本地忙碌状态，不保留假进度。
- 打开系统相机/相册本身不触发业务中断；照片操作继续使用 `PhotoOperationStateStore` 的单一终态消费。

### 4.6 后续真正后台执行

本次不实现，但路线固定如下：

1. **Media3 渲染**：把已验证的 `production-plan.v1` 交给 `mediaProcessing` 前台服务；服务展示常驻通知、在工作线程执行、写原生事实收据，完成/失败/超时时停止自身。TypeScript 在前台或重启后读取收据并更新唯一业务项目状态。
2. **大文件下载/上传**：Android 14+ 优先 user-initiated data transfer job；旧版本使用长时 WorkManager 前台 worker。下载必须有临时文件、断点元数据、校验和与原子替换。
3. **完整采集/AI Flow**：先设计 `task-checkpoint.v1`、步骤幂等键、执行租约和安全的 Provider 配置引用，再评估可复用共享 TypeScript 的无 WebView 执行环境。不得在 Kotlin 重写平台解析、Prompt 或 Schema。

目标 SDK 36 下，`dataSync` 与 `mediaProcessing` 前台服务需要声明具体 service type 和相应权限，并受后台累计时长、启动时机和 Android 16 job quota 约束；不能用一个无类型常驻 Service 规避系统规则。

## 5. 权限设计

### 当前保持

- 保留 `INTERNET`。
- 保留对 `android.media.action.IMAGE_CAPTURE` 的 package visibility 查询。
- 保留不可导出的 `FileProvider` 和单 URI 临时读写授权。
- 不新增 `CAMERA`、`READ_MEDIA_IMAGES`、`READ_EXTERNAL_STORAGE`、`MANAGE_EXTERNAL_STORAGE`。
- 不在应用启动时批量索取权限。

### 未来 CameraX 触发条件

只有产品明确需要应用内取景器、对焦、曝光或连拍时才引入 CameraX。届时必须：

1. Manifest 声明 `CAMERA` 与非强制相机硬件特性；
2. 用户点击“应用内拍照”后才解释并申请；
3. 拒绝时仍保留系统相机/相册降级入口；
4. 永久拒绝时提供打开应用详情设置的明确动作；
5. 页面只消费版本化权限 DTO，不解析 Android 权限字符串。

## 6. 测试与验收

### 自动化

- 每一类未终态都有先失败后通过的恢复测试；覆盖幂等、已终态不变和已有产物/字段保留。
- Runtime 聚合测试覆盖部分失败隔离、内存活动操作和 external-activity 例外。
- Web 测试覆盖 `appStateChange` 的 inactive→active 顺序、需要重载与只刷新两条分支。
- Android 边界测试锁定外部相机 Intent、FileProvider URI grant，以及 Manifest 不含相机/全量相册危险权限。
- 运行定向测试、`pnpm check`、Web build、Android JVM 测试、lint、debug 构建、UTF-8/U+FFFD 与 `git diff --check`。

### 端侧

若有可用独立模拟器或真机：

1. URL 采集、内容拆解、观察报告、制作计划和视频渲染分别在运行中按 Home 或切换应用；返回后不得继续永久显示运行中。
2. 对完成于后台的短操作，页面返回后读取真实终态。
3. 在运行中执行 `adb shell am kill com.hongtai.aiagent`，重新进入后检查统一中断映射和旧产物保留。
4. 打开系统相机与 Photo Picker，确认不会被通用生命周期恢复误判；确认应用详情没有不必要的相机/相册危险权限。
5. 物理真机、OEM 后台限制和正式 release 若未实际执行，必须明确标记未验证。

## 7. 官方依据

- [Android 进程与应用生命周期](https://developer.android.com/guide/components/activities/process-lifecycle)
- [Android 后台任务概览](https://developer.android.com/develop/background-work/background-tasks)
- [Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android 15 前台服务超时](https://developer.android.com/develop/background-work/services/fgs/timeout)
- [Android 用户发起的数据传输](https://developer.android.com/develop/background-work/background-tasks/uidt)
- [Android Camera Intent](https://developer.android.com/media/camera/camera-intents)
- [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker)
- [Capacitor App API](https://capacitorjs.com/docs/apis/app)
- [Capacitor Background Runner 限制](https://capacitorjs.com/docs/apis/background-runner)

## 8. 自审结果

- 无待定占位、未完成项或未选择方案。
- “可靠降级”与“真正后台执行”分开表述，没有把重载/中断冒充续跑。
- 权限设计与当前实现一致，没有为制造系统权限板块而扩大权限。
- 恢复聚合不复制业务 Flow，各服务仍拥有唯一状态源。
- 范围可在一个实施计划内完成；原生前台服务、断点续传和 CameraX 均明确留在后续独立任务。
