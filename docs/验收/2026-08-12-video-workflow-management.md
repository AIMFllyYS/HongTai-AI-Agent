# 本地视频拆解、制作删除与模板管理验收

> 日期：2026-08-12
> 分支：`feat/video-workflow-management`
> 范围：本地 MP4 自动拆解、终态任务删除、制作素材/成片/项目删除、模板自定义与删除、五项底部导航迁移。
> 结论：共享逻辑、Android I/O、运行时、Web 交互和 Debug APK 构建均已通过自动化与浏览器端测；本机 ADB 无设备，因此未执行 Android 模拟器或物理真机的系统选择器、Media3 和重启持久化 E2E。

本文是日期证据，不是当前能力或正式发布状态的权威来源；当前事实以[当前能力与发布状态](../当前能力与发布状态.md)为准。

## 任务契约

### 用户结果

- 拆解首页既接受公开分享文本，也允许用户选择一个本地 MP4；本地视频复用同一七阶段、ASR 证据、正式文稿和 `content-analysis.v1`，不伪装成公网平台。
- 用户可以在任务详情删除终态任务及私有视频，在制作页删除单份素材、成片或整个项目；所有动作都有具名二次确认并作用于原生私有文件。
- 正式拆解中的 `reusableTemplate` 可保存为独立模板；用户也可新建、编辑和删除自己的模板。
- 底部五项稳定为 `AI / 拆解 / 制作 / 模板 / 设置`；原 `/assets` 只作为 `/templates` 的兼容别名。

### 明确边界

- 不实现时间线剪辑、撤销/重做、通用素材库、模板市场、云同步或发布。
- 运行中的任务、规划中的项目和渲染中的项目拒绝删除；删除失败不能伪造成功。
- 模板不保存原视频、私有路径、供应商响应或 reasoning；删除来源任务不级联删除已保存模板。
- 本轮没有 Android 设备，因此不把浏览器 harness、JVM 测试或 APK 构建写成真机通过。

## 实现与状态权威

| 能力 | 权威 ID / 状态 | 实现事实 |
| --- | --- | --- |
| 本地视频拆解 | `taskId`、七个 `TaskStage`、独立 `analysisStatus` | `AnalysisService.importVideo()` 组合系统选择、私有复制、唯一 `IngestPipeline` 和既有 `ContentAnalysisFlow` |
| 任务删除 | `taskId` | 仅终态可删；删除 `tasks/<taskId>/`，模板与制作项目不级联 |
| 制作删除 | `projectId` | 同 ID single-flight；素材删除清计划/成片，成片删除保留计划，项目删除受控根 |
| 模板管理 | `templateId` | 有界 JSON 原子写入 `templates/<templateId>/template.json`；支持导入、新建、编辑、删除 |
| 页面迁移 | canonical route | `/templates` 为真实模板页，`/assets` 为无状态兼容别名 |

阶段提交：

- `84c5f1a`：本地视频来源、七阶段与正式拆解契约；
- `854ea36`：Android 私有 MP4 导入和受控删除端口；
- `a927e92`：任务、拆解、制作与模板运行时服务；
- `b782a09`：五项导航、上传入口、删除确认与模板页面。

## 自动化验证

### TypeScript 与 Web

在 `b782a09` 后运行：

```text
pnpm check
pnpm --filter @hongtai/web build
```

结果：类型检查、ESLint 和 193 个根测试全部通过；Vite 转换 612 个模块并成功产出。仍有单个 JS chunk 大于 500 kB 的非阻断提示，本轮未以无关拆包扩大范围。

定向覆盖包括：

- 本地视频严格保留七阶段、跳过平台 adapter/下载器、生成真实 ASR 证据并使用 `local_upload`；
- MP4 scheme、MIME、250 MB 上限、`ftyp`、视频轨与正时长；受控 task/production/template 路径；
- 任务终态删除、项目 single-flight、素材/成片/项目删除状态转换；
- 模板从正式拆解复制、自定义、持久化重载、字段边界和删除；
- 五项导航、`/assets` 别名、真实 AppRuntime 边界、具名删除确认和 390px 布局。

### Android

执行：

```text
android/gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

结果：`BUILD SUCCESSFUL`，137 个 Gradle task（87 executed、50 up-to-date）；Android JVM 55/55 通过。应用 lint 为 0 errors / 23 warnings；Capacitor 依赖的既有 baseline 另提示 6 条已不再出现的记录。Debug APK 构建成功。

## 浏览器交互端测

使用真实 Chromium、正式 React 页面和 CSS，并注入只在端测进程中存在的受控 `AppRuntime`。该 harness 已在测试后删除，没有进入产品源代码；它验证页面契约和用户交互，不代表 Android 文件选择器或 Media3 真机 E2E。

实测闭环：

1. 1280×900 打开拆解首页，五个底部入口均存在；
2. 点击“上传本地视频并自动拆解”，进入共用拆解结果并显示“本地上传 · 仅使用已保存文稿证据”；
3. 进入模板页，新建并填写名称、摘要、公式、步骤和变量，保存后从列表删除；
4. 切换 390×844，确认模板页无横向溢出、导航与操作可读；
5. 进入制作页，依次确认并删除成片、单份素材和整个项目；
6. 最终输出 `console_errors=0`、`page_errors=0`。

截图保存在未跟踪的本地验收目录：

- [`desktop-task-home.png`](../../output/acceptance/video-workflow/desktop-task-home.png)
- [`mobile-templates-390.png`](../../output/acceptance/video-workflow/mobile-templates-390.png)
- [`mobile-production-delete-confirm.png`](../../output/acceptance/video-workflow/mobile-production-delete-confirm.png)

全页截图中的 fixed bottom nav 会出现在页面中段，这是 Chromium 全页截图对 fixed 元素的表现；真实点击采用正常滚动与非强制点击，完整闭环通过。

## APK 身份

APK 由产品源码提交 `b782a0930ca5e818780c31ee7c9163239bf77c98` 构建；随后仅追加本文和活文档，不改变 APK 字节。

| 字段 | 值 |
| --- | --- |
| 绝对路径 | `D:\projects\Dev-Tools\HongTai-AI-Agent\.worktrees\video-workflow-management\android\app\build\outputs\apk\debug\app-debug.apk` |
| 包名 | `com.hongtai.aiagent` |
| versionCode / versionName | `3` / `0.0.1` |
| minSdk / targetSdk | `24` / `36` |
| 字节数 | `7,756,749` |
| SHA-256 | `f6be00928c3102d9844178ca5f13ce6ef37226bca1604578414b4878594e644c` |
| 签名 | Android Debug；证书 SHA-256 `b9d31f9089bf70b5fb487200021a3a35f1001e9b32c8dddf7aa0d8c0bdc66bd8` |

该 APK 仅用于 Debug/QA，不是团队 release 签名产物。

## Android 端测缺口

执行 `adb devices -l` 后输出只有 `List of devices attached`，没有序列号。因而本轮没有安装 APK，也没有在 Android 上实际选择 MP4、调用 ASR/AI、删除私有文件、执行 Media3 合成或重启检查持久化。

后续设备验收必须使用上述同一 SHA-256 或重新记录新 APK 身份，并至少覆盖：

1. 选择有效 MP4、取消选择、非 MP4、超限文件和无视频轨文件；
2. 本地视频七阶段、真实 ASR 证据、自动拆解与无口播空结果；
3. 模板保存/编辑/删除以及删除来源任务后模板仍存在；
4. 删除素材后计划/成片失效、删除成片后计划保留、删除项目后重启不再出现；
5. 规划/渲染中删除被拒绝，外部 Activity 或进程中断进入可解释终态；
6. 物理机记录型号、Android 版本、WebView 版本、剩余存储、APK 哈希和每个实际结果。
