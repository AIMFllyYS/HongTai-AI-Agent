# v0.1.4 本地视频拆解、制作删除与模板管理验收

> 日期：2026-08-12
>
> 分支：`feat/video-workflow-management`
>
> 产品源码提交：`874220f`
>
> 范围：版本谱系恢复、本地 MP4 自动拆解、终态任务删除、制作素材/成片/项目删除、模板自定义与删除、五项底部导航迁移。
>
> 结论：`v0.1.4` / `versionCode=11` Debug 候选已通过自动化、真实 Chromium、API 35 x86_64 模拟器无降级升级、Android 系统选择器取消/有效 MP4 导入和任务删除端测；没有物理 Android 设备、有效 AI Key 或正式 release 签名，因此不声称物理真机、完整 AI 拆解、Media3 真机合成或正式发布通过。

本文是日期证据，不是当前能力或正式发布状态的权威来源；当前事实以[当前能力与发布状态](../当前能力与发布状态.md)为准。

## 第一性原理与任务契约

本轮管理能力解决的不是“多放几个删除按钮”，而是本地优先应用最基本的三个闭环：

1. 用户把大体积私有媒体交给应用后，必须能撤回并确认物理文件确实删除，不能只隐藏列表记录；
2. “AI 拆解”应接受用户真正拥有的视频，并复用唯一的采集、ASR、证据与 Schema 流程，不能复制第二套伪流程；
3. 可复用知识应从一次性任务中独立出来，允许用户自定义、修改和删除，同时不复制原视频、私有路径或供应商 reasoning。

由此确定以下边界：

- `taskId`、`projectId`、`templateId` 各自只有一个状态权威；运行中的任务或制作项目拒绝删除；
- 删除必须进入受控 Android 私有根并由稳定 DTO 驱动，页面不接触文件系统路径；
- 外部系统选择器尚未返回有效 MP4 时不创建任务快照，取消或 Activity 生命周期竞态不能留下空任务；
- 模板与来源任务解耦，删除来源任务不级联删除已保存模板；
- 不扩写为时间线剪辑、撤销/重做、通用素材库、模板市场、云同步或平台发布。

## 版本谱系与 D 盘迁移结论

问题不是 D 盘 Android SDK 或项目目录本身损坏，而是分支谱系分离：D 盘 `main` 与最初的功能分支仍停在历史 `0.0.1/code3`，真实 `0.1.3/code10` 位于尚未合回 `main` 的 `fix/issue05-issue07` 分支。若继续直接开发，会把新功能建立在低版本父提交上，并产生版本回退。

处理结果：

- 将 `fix/issue05-issue07` 的真实 `0.1.3/code10` 应用能力合入当前功能分支，保留双方实现并解决冲突；
- Android 源码候选递增为 `versionName=0.1.4`、`versionCode=11`；
- 根目录新增 [`CHANGELOG.md`](../../CHANGELOG.md)，默认只增加第三位补丁版本，前两位仅在产品负责人明确授权时变化；
- `download.html` 仍保留已公开的 `0.1.3` 及历史 SHA-256，未把尚未正式发布的 `0.1.4` 伪装成公开下载版本；
- D 盘 SDK 通过工作树内忽略的 `android/local.properties` 指向 `D:\Android\SdkMain`；构建使用 Android Studio 的 JDK 21。SDK 已在 D 盘，JDK 仍来自 `C:\Program Files\Android\Android Studio\jbr`，不宣称全部工具已迁到 D 盘。

## 实现与状态权威

| 能力 | 权威 ID / 状态 | 实现事实 |
| --- | --- | --- |
| 本地视频拆解 | `taskId`、七个 `TaskStage`、独立 `analysisStatus` | `AnalysisService.importVideo()` 组合系统选择、私有复制、唯一 `IngestPipeline` 和既有 `ContentAnalysisFlow`；选择前不创建任务 |
| 任务删除 | `taskId` | 仅终态可删；删除 `tasks/<taskId>/`，模板与制作项目不级联 |
| 制作删除 | `projectId` | 同 ID single-flight；素材删除清计划/成片，成片删除保留计划，项目删除受控根 |
| 模板管理 | `templateId` | 有界 JSON 原子写入 `templates/<templateId>/template.json`；支持导入、新建、编辑、删除 |
| 页面迁移 | canonical route | 底部为 `AI / 拆解 / 制作 / 模板 / 设置`；`/templates` 为真实模板页，`/assets` 为无状态兼容别名 |

此前独立功能阶段提交：

- `84c5f1a`：本地视频来源、七阶段与正式拆解契约；
- `854ea36`：Android 私有 MP4 导入和受控删除端口；
- `a927e92`：任务、拆解、制作与模板运行时服务；
- `b782a09`：五项导航、上传入口、删除确认与模板页面；
- `874220f`：恢复 `0.1.3` 父版本、递增 `0.1.4/code11`、增加更新日志、修复选择器取消事务边界并完成冲突集成。

## 自动化与构建验证

### TypeScript 与 Web

```text
pnpm check
pnpm --filter @hongtai/web build
```

- TypeScript、ESLint 和根测试 `236/236` 通过；
- 其中 `@hongtai/capacitor-runtime` 定向测试 `42/42` 通过；新增回归测试会在选择器打开时断言任务列表仍为空；
- Vite 转换 617 个模块并成功产出；JS chunk 大于 500 kB 是非阻断提示，本轮没有用无关拆包扩大范围；
- Capacitor 同步完成，源码/文档/资源 U+FFFD 扫描为 0。

### Android

```text
android/gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

- `BUILD SUCCESSFUL`，129 个 app 相关 task（15 executed、114 up-to-date）；
- Android JVM：17 个 suite、70/70 通过，0 failure/error/skipped；
- 应用 lint：0 errors / 23 warnings；
- Debug APK 与 androidTest APK 均构建成功；四个 ABI 均包含 `libde265.so`、`libheif.so` 和 `libhongtai_heif.so`，共 12 个 `.so`；
- 原生 HEIF 源锁验证为 libheif `2c4bbb54...`、libde265 `4dd701ff...`。

## Chromium 页面端测

使用真实 Chromium、正式 React 页面与 CSS，并注入仅存在于端测进程的受控 `AppRuntime`；harness 测后已删除，没有进入产品源代码。

实测通过：

1. 1280×900 页面存在 `AI / 拆解 / 制作 / 模板 / 设置` 五项导航；
2. 本地视频入口只调用一次复用的 `analysis.importVideo()` 并进入拆解视图；
3. 模板新建、编辑、保存、列表恢复与二次确认删除；
4. 制作页依次二次确认删除成片、素材和整个项目；
5. 390px 移动端无横向溢出；
6. `console_errors=0`、`page_errors=0`。

对应截图保存在未跟踪的本地验收目录：

- [`desktop-task-home-v0.1.4.png`](../../output/acceptance/video-workflow/desktop-task-home-v0.1.4.png)
- [`mobile-templates-390-v0.1.4.png`](../../output/acceptance/video-workflow/mobile-templates-390-v0.1.4.png)
- [`mobile-production-delete-confirm-v0.1.4.png`](../../output/acceptance/video-workflow/mobile-production-delete-confirm-v0.1.4.png)

## Android 模拟器端测

环境：`SciChatApi35` x86_64 AVD、Google Android WebView `124.0.6367.219`。这是模拟器证据，不是物理真机证据。

### 无降级升级

1. 安装历史 `v0.1.3/code10` Debug APK；
2. 使用 `adb install --no-streaming -r` 安装本轮 `v0.1.4/code11`，没有卸载、没有 `-d`；
3. 两次安装均 `Success`，`firstInstallTime` 保持不变，包名和 Debug 证书一致。

### 系统选择器取消

- 首页真实渲染后点击“上传本地视频并自动拆解”，前台 Activity 为 Android `DocumentsUI PickActivity`；
- 打开前任务数 `0`，选择器打开期间任务数 `0`，返回键取消并恢复 `MainActivity` 后任务数仍为 `0`；
- Logcat Fatal 为 0；页面“取消选择不会留下空任务”与实际行为一致。

### 有效 MP4 导入与删除

- 端测生成 3 秒、32,314 字节的 H.264/AAC MP4，SHA-256 为 `2d7717d6fd51af2d9d5a1cf43046034275379f7c7d71af0e335b09878e15e0b4`；
- 通过系统 Downloads 选择后，应用私有任务目录真实保存 `media/video.mp4`、`media/audio.wav`、`events.jsonl`、`metadata.json`、`request.json` 和 `task.json`；
- 模拟器没有写入 AI Key，ASR 阶段如实进入 `AI_NOT_CONFIGURED`，任务状态为 failed、`analysisStatus=not_started`，没有伪造文稿或拆解结果；
- 任务详情显示真实 3 秒视频和稳定错误；经页面“删除任务 → 确认删除任务”，私有任务目录从 1 回到 0；
- 端测样本已从模拟器 Downloads/MediaStore 删除。

截图：

- [`emulator-home-v0.1.4.png`](../../output/acceptance/video-workflow/emulator-home-v0.1.4.png)
- [`emulator-video-picker-v0.1.4.png`](../../output/acceptance/video-workflow/emulator-video-picker-v0.1.4.png)
- [`emulator-local-task-history-v0.1.4.png`](../../output/acceptance/video-workflow/emulator-local-task-history-v0.1.4.png)
- [`emulator-local-task-detail-v0.1.4.png`](../../output/acceptance/video-workflow/emulator-local-task-detail-v0.1.4.png)

冷启动首次截图过早时只出现系统栏；继续等待后正式页面完成绘制，日志无 JavaScript 异常。该模拟器首次冷绘制约需十几秒，属于本轮观察到的性能边界，不把 Activity 已启动等同于首屏已经可交互。

## APK 身份

APK 由产品源码提交 `874220f` 构建；此后仅更新本验收文档和活状态文档，不改变 APK 字节。

| 字段 | 值 |
| --- | --- |
| 绝对路径 | `D:\projects\Dev-Tools\HongTai-AI-Agent\.worktrees\video-workflow-management\android\app\build\outputs\apk\debug\app-debug.apk` |
| 包名 | `com.hongtai.aiagent` |
| versionCode / versionName | `11` / `0.1.4` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| 字节数 | `39,330,485` |
| SHA-256 | `1e90709a622a804b81ef7e80ccd462f77bf5d66681a18d331b95077e841d43a9` |
| ABI | `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` |
| 签名 | Android Debug；APK Signature Scheme v2；证书 SHA-256 `b9d31f9089bf70b5fb487200021a3a35f1001e9b32c8dddf7aa0d8c0bdc66bd8` |
| androidTest APK | 583,423 字节；SHA-256 `bd8c5d9f93dcc077f6be5702c87671145c985b06f035c9ad56fa7f3df65d3008` |

该 APK 仅用于 Debug/QA，不是团队 release 签名产物；`download.html` 仍应保持公开推荐版本 `0.1.3`，直到 `0.1.4` 完成正式签名、物理真机门禁并被实际发布。

## 尚未验证的正式发布边界

- 没有物理 Android 设备，未验证 OEM 系统选择器、ARM 媒体栈、相册权限差异或正常升级；
- 没有写入真实 AI Key，未在 Android 端完成云端 ASR 与 `content-analysis.v1` 成功结果；
- 没有在物理机验证 Media3 合成、云端/系统 TTS、编码器兼容和制作删除重启闭环；
- 没有使用团队 release 私钥构建本轮 APK，也没有更新公开下载页。

这些边界不会被浏览器 harness、模拟器、JVM 测试或 Debug 签名替代。
