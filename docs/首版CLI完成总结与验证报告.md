# 首版 CLI 完成总结与验证报告

> 阶段：首版 CLI（公开视频采集链路）
> 提交：`be850b5 feat(cli): complete public video ingest workflow`

## 1. 概述

首版 CLI 已经完成，抖音、小红书、B站三个平台的**公开视频链接**均已真实跑通完整链路：

```text
解析 → 下载 → FFmpeg 处理 → 产物保存
```

首版仅面向公开、单条视频链接，不处理 Cookie、自动登录、批量下载和画面修复型去水印。

## 2. 主要入口

| 内容 | 路径 |
| --- | --- |
| CLI 源码 | `apps/cli/src/index.ts` |
| 项目说明 | `README.md` |
| CLI 运行说明 | `docs/CLI运行与产物说明.md` |

## 3. 环境准备与运行

### 3.1 安装与配置

```powershell
cd D:\projects\Dev-Tools\HongTai-AI-Agent
pnpm install
Copy-Item .env.example .env
```

在 `.env` 中填写：

```text
HONGTAI_AI_API_KEY=你的API密钥
```

> 仓库内未写入 `.env` 或真实密钥，密钥不会进入提交记录。

### 3.2 运行命令

```powershell
# 最简调用
pnpm cli ingest "公开视频链接"

# 指定输出目录
pnpm cli ingest "公开视频链接" --output "D:\HongTaiOutput"

# 限制视频时长上限
pnpm cli ingest "公开视频链接" --max-duration 600
```

## 4. 三平台验证结果

| 平台 | 链接类型 | 验证结果 |
| --- | --- | --- |
| 抖音 | 短链 | 成功解析并下载，视频约 9.8 秒 |
| 小红书 | 短链 | 成功解析并下载，视频约 15 秒 |
| B站 | 完整链接 | 成功下载 DASH 音视频并合并，视频约 67 秒 |

补充行为：

- 抖音桌面页触发风控时，会自动降级读取公开移动分享页。
- 三个平台视频均通过 FFprobe 检查，媒体完整性正常。

## 5. MiMo 语音转写说明

MiMo 的请求格式、切片转写、失败重试与整理稿逻辑已通过**模拟接口**测试。由于仓库内未配置真实密钥，真实 MiMo 账户调用需要本地填写 `.env` 后再行验证。

降级逻辑：

- 未配置 MiMo 时：仍然下载视频，并使用平台描述生成**降级文稿**（不代表真实语音逐字稿）。
- 已配置 MiMo 时：才会产生真实的语音转写（`transcript.txt`）与整理稿（`draft.txt`）。

## 6. 质量门禁

- `pnpm check` 全部通过，共 **8 项测试**。
- 三个平台视频均通过 FFprobe 检查。
- UTF-8 编码检查、Git 差异检查与密钥扫描通过。
- 当前工作区干净。

## 7. 任务产物位置

默认产物目录：

```text
workspace/tasks/{task-id}/
```

目录结构见 `README.md` 的「输出目录」章节，核心产物包括 `metadata.json`、媒体文件与 `transcript/` 下的转写与整理稿。

## 8. 后续待办

- 真实 MiMo 账户端到端验证（需本地 `.env` 配置后执行）。
- 持续关注各平台风控与页面结构变化，必要时更新 `raw/` 原始样本与解析规则。
