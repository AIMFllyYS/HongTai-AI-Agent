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

CLI既接受纯链接，也接受平台复制出的整段分享文字：

```powershell
pnpm cli ingest "https://公开视频链接"
pnpm cli ingest "7.94 复制打开抖音，看看作者作品 https://v.douyin.com/xxxxxx/ 其他分享文字"
pnpm cli ingest "小红书分享内容 http://xhslink.cn/o/xxxxxx 这篇笔记等你来看"
```

系统会跳过无关网址，按出现顺序使用第一个有效的抖音、小红书或B站链接。无协议链接会补全HTTPS，受支持域名的HTTP链接会在请求前升级为HTTPS。

CLI依次显示平台识别、短链解析、内容提取、媒体选择、下载、文稿和产物保存七个阶段。

## 3. 状态含义

- `succeeded`：视频及文稿完整、视频确认没有有效口播，或小红书图文正文和图片完整；
- `degraded`：已有可用产物，但部分图片、转写或整理稿失败；
- `failed`：没有获得当前内容类型所需的核心产物。

退出码规则：视频任务需要视频，并且已经生成文稿或确认`no_speech`；图文任务需要正文或至少一张图片。缺少核心产物时为1。

图文笔记产物：

```text
content/content.txt
media/images/image-001.*
media/images/image-002.*
```

图文笔记不会调用ASR。

## 4. 无口播视频

MiMo请求成功但所有音频分段均没有有效文字时，任务返回：

```text
speechStatus=no_speech
```

这是一种正常结果：任务保持`succeeded`，不生成伪造的`transcript.txt`或`draft.txt`，也不会使用平台描述冒充语音转写。`transcript/transcript.json`会保留`no_speech`状态和分段结果。

## 5. 常见失败

- `INPUT_NO_SUPPORTED_URL`：分享文字中没有受支持链接；
- `CONTENT_SCHEMA_CHANGED`：平台页面结构发生变化；
- `CONTENT_PRIVATE_OR_LOGIN_REQUIRED`：作品私密或需要登录；
- `MEDIA_DOWNLOAD_FAILED`：媒体服务器或网络下载失败；
- `AI_AUTH_INVALID` / `AI_PERMISSION_DENIED`：API Key或模型权限错误；
- `AI_QUOTA_EXHAUSTED`：AI账户余额或额度不足；
- `AI_RATE_LIMITED`：AI调用频率受限，CLI会有限重试；
- `AI_EMPTY_RESPONSE`：AI响应缺少预期字段，不等同于没有口播；
- `STORAGE_SPACE_INSUFFICIENT`：本地空间不足；
- 下载HTTP 403：平台CDN验证了Referer或媒体地址已过期；
- FFmpeg失败：本机未安装FFmpeg，或B站音视频流编码不兼容；
- 只有平台描述：语音转写失败后使用描述字段降级，不代表真实语音逐字稿。

CLI会打印稳定错误码；未来前端使用错误码、严重程度和建议动作展示弹窗，不解析中文错误文本。

首版不自动登录或读取浏览器Cookie。遇到需要登录的作品会明确失败，不进行隐藏式绕过。
