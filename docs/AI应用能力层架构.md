# 宏泰 AI 应用能力层架构

> 本文说明既有 AI Flow 的业务边界与迁移方向。APK 的分层、安全存储、`AppRuntime`、状态机和真机验收以[架构与工程规范](架构与工程规范.md)为全局唯一基线。

## 已锁定的集成阶段

在既有链接解析、下载、转写和 CLI 基础上，首轮 APK 集成以下两个 AI 应用能力：

1. 舌象或面部图片观察、结构化报告和后续对话；
2. 对已抓取视频或图文内容进行可复用的结构化拆解。

自动视频合成、素材库和发布仍为 `planned`。本地档案、AI 设置、Capacitor、Kotlin、SQLCipher、私有媒体目录和 React 页面将以不复制 Flow 业务逻辑的方式接入；不引入云端服务、登录或云同步。

## 代码边界

```text
apps/cli                 命令、开发期图片上传入口、终端日志
packages/core            既有抓取任务、通用错误和运行契约
packages/platforms       抖音、小红书、B站稳定解析与快手实验性解析
packages/ai              纯TypeScript AI Provider、Schema、Prompt和Flow
packages/node-runtime    Node文件、图片预处理和开发期产物存储
packages/capacitor-runtime  APK 的运行时适配与 AppRuntime 组合
android                  Kotlin 原生插件、SQLCipher 与 Android 生命周期
```

`packages/ai` 不得导入 Node、Capacitor 或 Android API。具体业务 Prompt 和 Schema 彼此隔离，只共享 Provider、流式事件、结构化 JSON 校验和错误机制。页面通过 `AppRuntime.analysis` 与 `AppRuntime.diagnosis` 调用 Flow，不直接读取开发期产物或原始供应商响应。

目录随真实实现逐步建立，不创建无行为的占位模块：

```text
packages/ai/src/
├── contracts
├── providers
├── structured-output
├── context
├── prompts
├── schemas
└── flows
    ├── diagnosis
    └── content-analysis
```

## OpenAI 兼容边界

AI连接必须显式配置 Base URL、API Key 和当前命令所需模型，不内置默认供应商。文本和视觉请求使用 OpenAI Chat Completions 兼容协议；ASR同时支持标准音频转写端点和可配置的聊天音频适配器。模型能力按命令校验，避免内容拆解被无关的视觉模型配置阻断。Node 继续使用 Fetch/Undici 路径；Android 通过可替换 `AiTransport` 读取私有原生 URI、附加 Keystore 凭据、处理 SSE 与媒体上传。完整 Key 永不返回 React。

模型思考能力使用供应商默认行为，不要求 `<thinking>` 标签。供应商返回的独立 reasoning 只作为开发调试流显示和保存，不进入正式业务结果或后续会话上下文。

## 唯一结构化协议

两个 Flow 的正式结果统一为经过运行时 Schema 校验的 JSON。Zod 是业务契约的唯一来源，Provider使用的JSON Schema和Prompt中的字段契约均由Zod自动生成，避免三套定义漂移。供应商能力按`JSON Schema严格模式 → JSON Object → Prompt-only`降级；JSON Object只保证JSON语法，不代表符合业务Schema。解析或校验失败时只允许一次带完整Schema的格式修复，再失败返回稳定错误。

内容拆解只允许从真实转写segment或图文paragraph生成核心结论。标题和作者保留为任务元数据，但不会进入模型的分析证据上下文；ASR失败并改用平台描述时，来源必须记录为`description`，不能伪装成`asr`。证据不足时允许空受众、空结构和空模板步骤，禁止为了满足Schema虚构内容。

XML 不作为模型约束、存储格式或前端契约。

## 开发期入口与存储

- `pnpm cli diagnosis serve`：启动仅绑定 `127.0.0.1` 的图片和对话测试入口；
- `pnpm cli analyze-content <task-id>`：读取既有任务产物并生成内容拆解；
- 报告、消息、上下文摘要、运行记录和 reasoning 保存到 `workspace`；
- 页面只显示报告摘要和对话，完整 JSON、reasoning、错误和路径由 CLI 与产物文件承担。

Android 阶段通过相同能力接口替换 Node 文件存储和设备适配，不复制 AI Flow。内容拆解只能由用户确认后显式开始，使用独立 `analysisStatus`，不能伪装为 URL 采集第八阶段。观察会话每次只选择舌象或面部一种模式，结果仅作日常健康参考，不能产生医学诊断、疾病概率、处方或健康评分。
