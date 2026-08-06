# 宏泰 AI 智能体

面向大健康门店老板的本地优先 Android AI 应用。最终交付是可独立安装的 APK：React 页面是**应用界面层**，共享 TypeScript 是**本地应用逻辑层**，Capacitor / Kotlin 是**平台运行时与原生能力层**；本项目不存在传统的远程 Web 后端。

仓库中的 CLI 是开发期诊断与回归入口，不能成为 APK 的运行依赖。APK 复用既有 `IngestPipeline`、内容拆解 Flow、图片观察 Flow 与平台解析；React 只显示真实 DTO，Kotlin 只提供 Key、私有文件、网络和必要媒体 I/O。首版任务状态和产物保存在应用私有文件目录，不预建 SQLCipher 任务数据库、后台续跑或第二个任务执行器。首轮真实能力包括本地档案、AI 设置、URL 采集、任务详情、用户确认后的内容拆解，以及舌象/面部观察与追问；制作、素材、发布目前只保留明确标注“尚未接入”的页面壳，不能伪造上传、生成或发布成功。

CLI 用于验证以下核心链路：

```text
抖音/小红书/B站公开视频链接，或快手匿名公开视频链接（实验性）
→ 解析作品和视频源
→ 下载本地视频
→ OpenAI兼容服务语音转写
→ OpenAI兼容服务整理文稿
→ 保存全部产物
```

在此基础上，还提供两个独立的 AI 应用能力：舌象/面部图片观察与多轮对话，以及对既有视频或图文任务进行证据可追溯的内容拆解。自动视频合成尚未接入。

采集入口只支持公开单条作品，不处理Cookie、自动登录、批量下载和画面修复型去水印。快手目前仅支持匿名公开单条视频，受平台风控影响时会结构化失败，不能视为正式稳定支持。

## 环境要求

- Node.js 24（最低建议20以上）；
- pnpm 10；
- 可从终端直接运行的 `ffmpeg` 和 `ffprobe`；
- 使用AI能力时需要一个兼容OpenAI格式的服务地址、API Key及相应模型。

检查本机环境：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-environment.ps1
```

## 安装

```powershell
pnpm install
Copy-Item .env.example .env
```

打开本地`.env`，显式填写自己的供应商配置：

```text
HONGTAI_AI_BASE_URL=https://你的服务地址/v1
HONGTAI_AI_API_KEY=你的API密钥
HONGTAI_TEXT_MODEL=文本模型
HONGTAI_VISION_MODEL=视觉模型
HONGTAI_ASR_MODEL=语音转写模型
HONGTAI_AI_JSON_OBJECT=true
HONGTAI_AI_JSON_SCHEMA=false
HONGTAI_AI_ASR_TRANSPORT=audio-transcriptions
```

项目不内置默认供应商。文本/视觉使用Chat Completions兼容协议；ASR可选择标准`audio/transcriptions`或兼容供应商的`chat-input-audio`。仅当供应商明确支持`response_format=json_schema`时将`HONGTAI_AI_JSON_SCHEMA`设为`true`；否则保留JSON Object或Prompt约束回退。

模型按命令校验：`ingest`只使用已配置的ASR和文本模型，`analyze-content`只要求文本模型，`diagnosis serve`要求文本与视觉模型。未配置视觉模型不会阻止单纯抓取下载。

`.env`、任务缓存和本地模型默认不会进入 Git。CLI 回归可使用本机受忽略的 `.env`；已安装的 APK 不读取、编译或通过 ADB 参数传入该文件。APK 的连接配置必须从设置页写入 Android Keystore 保护的本地安全存储，完整 API Key 永不回传给页面。

## 运行CLI

```powershell
pnpm cli ingest "公开视频链接"
```

示例：

```powershell
pnpm cli ingest "https://www.bilibili.com/video/BVxxxxxxxxxx"
pnpm cli ingest "https://v.douyin.com/xxxxxx/"
pnpm cli ingest "https://xhslink.com/o/xxxxxx"
pnpm cli ingest "https://v.kuaishou.com/xxxxxx"
```

指定输出目录或视频时长上限：

```powershell
pnpm cli ingest "公开视频链接" --output "D:\HongTaiOutput"
pnpm cli ingest "公开视频链接" --max-duration 600
```

启动仅供本地开发使用的图片观察与对话入口：

```powershell
pnpm cli diagnosis serve
```

浏览器打开终端显示的`127.0.0.1`地址，选择舌象或面部图片。页面只显示报告摘要和对话；完整JSON、reasoning和日志保存在`workspace/ai/diagnosis/`。

拆解一个已经完成的抓取任务：

```powershell
pnpm cli analyze-content "任务ID"
```

查看帮助：

```powershell
pnpm cli --help
```

## 终端进度

CLI会显示每一个基础阶段：

```text
[1/7] 识别平台     完成：bilibili
[2/7] 解析链接     完成：最终链接 ...
[3/7] 提取内容     完成：标题=...，视频源=...
[4/7] 选择视频     完成：1080p，无水印
[5/7] 下载视频     下载 43%｜18.2MB / 42.1MB
[6/7] 获取文稿     转写 2/3，已生成约 486 字
[7/7] 保存产物     完成：workspace/tasks/...
```

终端和任务日志不会输出API Key、Authorization、Cookie或base64音频。

## 输出目录

```text
workspace/tasks/{task-id}/
├── task.json
├── task.log
├── metadata.json
├── raw/
│   ├── page.html
│   └── response.json
├── media/
│   ├── video.mp4
│   ├── audio.wav
│   └── segments/
└── transcript/
    ├── transcript.txt
    ├── transcript.json
    └── draft.txt
```

其中：

- `transcript.txt`：忠实语音转写；
- `draft.txt`：补标点、去明显口癖和分段后的整理稿；
- `metadata.json`：平台元数据及媒体源；
- `raw`：平台排查结果；含临时签名地址的平台只保存安全投影，不保存查询参数、Cookie或原始错误正文。

舌象/面部会话保存为：

```text
workspace/ai/diagnosis/{session-id}/
├── session.json
├── source/normalized-image.jpg
├── report.json
├── messages.jsonl
├── context-summary.json
├── task.log
└── runs/{run-id}/
    ├── run.json
    ├── raw-response.json
    └── reasoning.jsonl
```

内容拆解结果保存到原任务的`analysis/`目录，核心文件为`content-analysis.json`。两个AI功能的唯一正式结构化协议都是经过Schema校验的JSON，不使用XML或`thinking`标签。

## 基础检查

```powershell
pnpm check
```

该命令执行TypeScript类型检查、ESLint和固定解析样本测试。

## 工程文档

- [架构与工程规范（全局唯一基线）](docs/架构与工程规范.md)
- [项目整体架构方向](docs/项目整体架构方向.md)
- [AI应用能力层架构](docs/AI应用能力层架构.md)
- [应用界面层数据对接清单](docs/前端显示板块对接清单.md)
- [错误码与应用界面通知约定](docs/错误码与前端通知约定.md)
- [开源项目参考对照](docs/开源项目参考对照.md)
- [CLI运行与产物说明](docs/CLI运行与产物说明.md)
- [首版CLI完成总结与验证报告](docs/首版CLI完成总结与验证报告.md)
