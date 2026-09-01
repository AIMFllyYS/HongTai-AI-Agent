# v0.1.34 Release 验收记录（候选构建与本地归档完成，未公网分发）

## 结论

模板页四项改动已完成源码、测试与文档锁定：①模板封面渐进失效根治（持久化首帧 + `<img>` 渲染）；②模板与拆解记录双向级联删除（含本机视频去留勾选框）；③拆解页历史从链接改为内容名称；④模板页/拆解页长按重命名。Android 源码推进到 `versionName=0.1.34` / `versionCode=42`，使用仓库外正式签名配置完成 Release 构建、签名后验和独立归档。

本候选**未上传公网、未切换 `download.html`**：公网推荐仍为 `v0.1.32`（code 40）。主机门禁通过不等于物理手机端测通过；构建时无设备连接记录，端侧验证未执行。

## 版本与文件

| 项目 | 结果 |
| --- | --- |
| applicationId | `com.hongtai.aiagent` |
| versionName | `0.1.34` |
| versionCode | `42` |
| Release APK | `output/apk-archive/HongTai-AI-Agent-release-v0.1.34.apk` |
| APK 大小 | `23,412,591` bytes |
| APK SHA-256 | `307fe0941610bfe9c64cc335a8115f7640f84fb7cd3a5971a69d74c4aa575f63` |
| 证书 SHA-256 | `54df122cd4f99720c613737815385e771bfaeb17715c160aed178062ab5b2fde`（与历史发布一致） |
| 公开推荐 | 仍为 `v0.1.32` / code40（`download.html` 未切换） |

## 修复内容与验证

### 1. 模板封面渐进失效（根治）

- **根因**：v0.1.33 起所有模板封面改为 `<video preload="metadata">` 现取首帧；模板页每页挂载 2N 个视频元素（精选轮播 + 目录网格），路由退场动画期间瞬时翻倍，卸载无清理，WebView 原生 MediaPlayer/流依赖 GC 回收 → 资源耗尽，表现为首次进入正常、来回切换后部分失效、最终全部「原视频封面不可用」。
- **修复**：新增原生 `captureFrame` 端口（`MediaRuntimePlugin` → `AndroidMediaRuntime.captureFrameNow`）：取 `media/video.mp4` 第 0 秒最近同步帧，最长边 720、JPEG q85、≤2MiB，经 `FrameJpegWriter`（与 ProductionInsightFrames 共享）原子写入 `media/thumbnail.jpg` 并做 FF D8 魔数复验。任务读路径（`#taskMedia`）对缺首帧的视频任务懒回灌：单flight、失败进程内记忆不重试、读路径永不抛错。封面投影三级优先：持久化首帧图片 → 本地视频 → 远端封面。模板卡片走 `<img>`；无首帧旧任务的 `<video>` 兜底卸载时 `pause + removeAttribute src + load()` 立即释放解码资源。`thumbnail.jpg` 在存储扫描中归类为可再生派生帧（`derived-frame`），可安全清理、读路径自动重建。
- **验证**：capacitor-runtime 190 项测试（含新增 7 条回灌 + 5 条投影三级契约）；Kotlin 侧 `FrameJpegWriterTest` 2/2、`StorageScannerTest` 11/11；`compileReleaseKotlin` 通过。浏览器端种子任务写入 `media/thumbnail.jpg` 后模板卡片走 `<img>` 渲染，页面来回切换 4 轮封面状态稳定（`output/browser-e2e/w234-09`）。

### 2. 模板删除 ↔ 拆解记录双向级联

- 运行时层：`TaskService.delete(taskId, { keepLocalVideo })` / `TemplateService.delete(templateId, { keepLocalVideo })`（`LinkedRecordDeleteOptions`）。任务删除先收集全部 `sourceTaskId` 匹配的模板，删任务目录（可选保留 `media/video.mp4`）后逐个删模板记录并发 `task-change.v1 deleted`；模板删除委托任务级联，来源任务缺失（悬挂）时退化为只删模板记录。原生 `PrivateArtifactStore.deleteTask` 支持 `keepRelativePaths`：非空时仅删除非保留文件与空目录。浏览器 dev 运行时同语义（`pruneExcept`）。
- UI 层：两个方向都先出统一 `ConfirmDeleteSheet` 二次确认；级联时显示红色警示块「将同时彻底删除模板「X」/对应拆解记录，无法恢复」；本机留有视频时显示「同时删除已下载到本机的视频」勾选框，**默认不勾 = 保留视频**。
- **验证**：运行时 6 个新单测（委托级联/悬挂退化/错误透出/无来源不级联/keepLocalVideo 断言）；浏览器端到端：模板页删除联动模板后来源任务从历史消失且 `media/video.mp4` 保留在盘；拆解页长按删除任务后对应模板从模板页消失（`w234-findings.json`、`w234b-findings.json` 全 PASS）。

### 3. 拆解页历史显示名称

- 层级：对应模板名称 → 拆解主题（`content-analysis.v1` overview.theme）→ 作品标题（详情 `content.title`）→ 链接/「我上传的视频」兜底；等宽 `technical-value` 样式只在最终显示 URL 时使用。名称扇出在 `loadHistory` 读令牌内并发完成，单任务读取失败只影响自己的回退。

### 4. 模板重命名

- 模板页长按卡片（轮播与目录两处）与拆解页长按记录均出操作弹层，新增「重命名」行；统一 `RenameSheet` 底部弹层（单行输入、非空拦截、80 字符上限与 `normalizedInput` 一致、Enter 提交）；保存走 `templates.update`，成功后刷新名称映射，两处列表同步。无模板的拆解记录该行禁用并提示「该拆解还没有模板，可先在详情页存为模板」。

### 端侧边界

- 构建与验收全程无 Android 设备/模拟器连接，真机行为未验证、不声称端侧通过。安装候选后应重点核对：模板页封面（持久化首帧是否生成、来回切换是否稳定）、级联删除两个方向、保留/删除本机视频勾选框、重命名。
- 存量任务无需迁移：无 `thumbnail.jpg` 的旧视频任务在首次读取时懒回灌；原生包过旧缺 `captureFrame` 方法时只记入失败集，封面退回既有 `<video>` 兜底。

## 发布命令与后验

```powershell
.\scripts\build-android-release.ps1
```

该命令本轮完成并通过：

- Web production build 与 Capacitor Android sync；
- `:app:testReleaseUnitTest`、`:app:lintRelease`、`:app:assembleRelease`（四 ABI）；
- APK 包名、源码版本一致性（`0.1.34`/code42）、16 KiB `zipalign`；
- 非 Debug 正式签名、v2/v3 签名、证书 SHA-256 锚定；
- APK SHA-256 计算与 `output/apk-archive/` 独立版本归档（不覆盖历史版本）。
