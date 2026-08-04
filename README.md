# 宏泰 AI 智能体

面向大健康门店老板的本地 Android 短视频生产工具。当前首先提供无界面的 CLI，用于验证以下核心链路：

```text
抖音/小红书/B站公开视频链接
→ 解析作品和视频源
→ 下载本地视频
→ MiMo语音转写
→ MiMo整理文稿
→ 保存全部产物
```

首版只支持公开、单条视频链接，不处理Cookie、自动登录、批量下载和画面修复型去水印。

## 环境要求

- Node.js 24（最低建议20以上）；
- pnpm 10；
- 可从终端直接运行的 `ffmpeg` 和 `ffprobe`；
- 生成语音文稿时需要小米MiMo API Key。

检查本机环境：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-environment.ps1
```

## 安装

```powershell
pnpm install
Copy-Item .env.example .env
```

打开本地`.env`，至少填写：

```text
HONGTAI_AI_API_KEY=你的API密钥
```

`.env`、任务缓存和本地模型默认不会进入Git。

## 运行CLI

```powershell
pnpm cli ingest "公开视频链接"
```

示例：

```powershell
pnpm cli ingest "https://www.bilibili.com/video/BVxxxxxxxxxx"
pnpm cli ingest "https://v.douyin.com/xxxxxx/"
pnpm cli ingest "https://xhslink.com/o/xxxxxx"
```

指定输出目录或视频时长上限：

```powershell
pnpm cli ingest "公开视频链接" --output "D:\HongTaiOutput"
pnpm cli ingest "公开视频链接" --max-duration 600
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
- `raw`：平台原始页面和响应，供平台规则变化时排查。

## 基础检查

```powershell
pnpm check
```

该命令执行TypeScript类型检查、ESLint和固定解析样本测试。

## 工程文档

- [项目整体架构方向](docs/项目整体架构方向.md)
- [架构与工程规范](docs/架构与工程规范.md)
- [开源项目参考对照](docs/开源项目参考对照.md)
- [CLI运行与产物说明](docs/CLI运行与产物说明.md)
- [首版CLI完成总结与验证报告](docs/首版CLI完成总结与验证报告.md)
