# 宏泰 AI 应用能力层架构

## 当前阶段

当前阶段在既有链接解析、下载、转写和 CLI 基础上增加两个 AI 应用能力：

1. 舌象或面部图片观察、结构化报告和后续对话；
2. 对已抓取视频或图文内容进行可复用的结构化拆解。

自动视频合成、正式用户界面、Capacitor、Kotlin、SQLite、MediaStore 和云端服务均不在本阶段实现范围内。

## 代码边界

```text
apps/cli                 命令、开发期图片上传入口、终端日志
packages/core            既有抓取任务、通用错误和运行契约
packages/platforms       抖音、小红书、B站解析
packages/ai              纯TypeScript AI Provider、Schema、Prompt和Flow
packages/node-runtime    Node文件、图片预处理和开发期产物存储
```

`packages/ai` 不得导入 Node、Capacitor 或 Android API。具体业务 Prompt 和 Schema 彼此隔离，只共享 Provider、流式事件、结构化 JSON 校验和错误机制。

规划中的目录随真实实现逐步建立，不创建无行为的占位模块：

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

AI连接必须显式配置 Base URL、API Key 和模型，不内置默认供应商。文本和视觉请求使用 OpenAI Chat Completions 兼容协议；ASR优先使用标准音频转写端点，同时保留可配置的聊天音频适配器。

模型思考能力使用供应商默认行为，不要求 `<thinking>` 标签。供应商返回的独立 reasoning 只作为开发调试流显示和保存，不进入正式业务结果或后续会话上下文。

## 唯一结构化协议

两个 Flow 的正式结果统一为经过运行时 Schema 校验的 JSON。支持 JSON Object 的供应商启用对应模式；其他供应商由 Prompt 约束只返回 JSON。解析或校验失败时只允许一次格式修复，再失败返回稳定错误。

XML 不作为模型约束、存储格式或前端契约。

## 开发期入口与存储

- `pnpm cli diagnosis serve`：启动仅绑定 `127.0.0.1` 的图片和对话测试入口；
- `pnpm cli analyze-content <task-id>`：读取既有任务产物并生成内容拆解；
- 报告、消息、上下文摘要、运行记录和 reasoning 保存到 `workspace`；
- 页面只显示报告摘要和对话，完整 JSON、reasoning、错误和路径由 CLI 与产物文件承担。

Android阶段通过相同能力接口替换 Node 文件存储和设备适配，不复制 AI Flow。
