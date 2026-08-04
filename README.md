# 宏泰 AI 智能体

面向大健康门店老板的本地 Android 短视频生产工具。

当前项目处于工程骨架阶段，优先建设无界面的本地处理核心，通过 CLI 验证以下主链路：

```text
视频链接 -> 平台解析 -> 媒体下载 -> 字幕优先/本地转写 -> 本地产物
```

当前不会实现 GUI，也不会实现真实的平台解析、下载或转写逻辑。

## 工程入口

- `apps/cli`：当前开发和调试入口。
- `packages/core`：与 Node、Android 无关的纯 TypeScript 核心契约。
- `packages/platforms`：抖音、小红书、B站适配器位置。
- `packages/node-runtime`：CLI 使用的文件、下载、媒体和本地模型能力。
- `android`：后续由 Capacitor 生成，现在不创建。

## 本地命令

```powershell
pnpm install
pnpm cli --help
pnpm check
```

当前 `ingest` 命令只确认输入和展示预定阶段，不执行真实任务：

```powershell
pnpm cli ingest "https://example.com/video"
```

## 文档

- [项目整体架构方向](docs/项目整体架构方向.md)
- [架构与工程规范](docs/架构与工程规范.md)
- [开源项目参考对照](docs/开源项目参考对照.md)

