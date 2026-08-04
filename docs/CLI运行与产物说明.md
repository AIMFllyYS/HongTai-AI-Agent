# CLI运行与产物说明

## 1. 首次准备

```powershell
cd D:\projects\Dev-Tools\HongTai-AI-Agent
pnpm install
Copy-Item .env.example .env
```

编辑`.env`并填写自己的API Key。默认配置使用：

```text
HONGTAI_AI_BASE_URL=https://api.xiaomimimo.com/v1
HONGTAI_ASR_MODEL=mimo-v2.5-asr
HONGTAI_TEXT_MODEL=mimo-v2.5
HONGTAI_MAX_DURATION_SECONDS=1200
```

API Key不得写进源码、文档或提交记录。

## 2. 运行

```powershell
pnpm cli ingest "https://公开视频链接"
```

CLI依次显示平台识别、短链解析、内容提取、媒体选择、下载、文稿和产物保存七个阶段。

## 3. 状态含义

- `succeeded`：视频、原始文稿和所需产物均成功；
- `degraded`：核心产物存在，但部分转写、整理稿或元数据缺失；
- `failed`：视频没有下载成功，或者最终没有任何可用文稿。

退出码规则：视频和文稿都存在时为0；缺少任意一个时为1。

## 4. 常见失败

- 页面没有公开数据：平台风控或页面结构已经变化；
- 没有视频源：输入的是图文作品，或者媒体字段发生变化；
- 下载HTTP 403：平台CDN验证了Referer或媒体地址已过期；
- FFmpeg失败：本机未安装FFmpeg，或B站音视频流编码不兼容；
- MiMo HTTP 401/403：API Key无效或账户没有对应模型权限；
- MiMo HTTP 429：调用频率或额度受限，CLI会有限重试；
- 只有平台描述：语音转写失败后使用描述字段降级，不代表真实语音逐字稿。

首版不自动登录或读取浏览器Cookie。遇到需要登录的作品会明确失败，不进行隐藏式绕过。
