# 本地爆款视频制作实施计划

> 目标：在不改动既有采集、七阶段任务、内容拆解和诊断逻辑的前提下，把 `content-analysis.v1`、用户经营需求与用户主动导入的素材，转换为可校验的 `production-plan.v1`，并在 Android 设备上通过系统 TTS 与 Media3 输出可播放 MP4。

## 冻结边界

- 仅新增独立的制作纵向能力；原任务状态机、平台解析器、AI Prompt、拆解 Schema 和诊断流程保持不变。
- 首版固定输出 9:16、720×1280、30 fps、15–60 秒、H.264/AAC MP4。
- 素材仅来自用户主动导入的 JPEG、PNG、WebP 或 MP4；拆解任务下载的原作品只作分析证据，不自动进入成片。
- 首版只支持硬切、单一字幕样式、系统 TTS 和静态背景音乐增益；不实现时间线编辑、转场市场、云渲染、素材库或自动发布。
- 制作项目使用独立私有目录，不新增数据库表，不复用或改写任务目录。
- TypeScript 负责业务计划、Schema 和状态；Kotlin 只负责系统选择器、TTS、文件 I/O 与 Media3 渲染。
- 每个阶段先观察失败测试，再写最小实现；精确暂存并创建本地提交。

## Task 1：正式制作计划契约与纯 TypeScript 规划流

**文件：**

- 新增：`packages/ai/src/contracts/production-planning.ts`
- 新增：`packages/ai/src/schemas/production-plan.ts`
- 新增：`packages/ai/src/prompts/production-planning.ts`
- 新增：`packages/ai/src/flows/production/production-planning-flow.ts`
- 修改：`packages/ai/src/index.ts`
- 新增：`tests/production-planning-flow.test.ts`

**步骤：**

- [ ] 先增加失败测试：计划必须为 `production-plan.v1`，时长、镜头顺序、素材引用、旁白与字幕都可验证。
- [ ] 定义最小输入：正式拆解文档、用户经营需求、目标时长、可用素材清单。
- [ ] 定义最小输出：全局设置、逐镜头素材引用、旁白、字幕和时间范围。
- [ ] 实现一次结构化生成与一次修复；拒绝不存在的素材 ID、重叠/断裂时间线和越界时长。
- [ ] 运行定向测试、类型检查、UTF-8 与 staged diff 检查。
- [ ] 提交：`feat(ai): add validated local production planning`

## Task 2：共享制作服务与项目私有文件

**文件：**

- 修改：`packages/core/src/application-runtime.ts`
- 修改：`packages/core/src/index.ts`
- 新增：`packages/capacitor-runtime/src/standalone-production-service.ts`
- 修改：`packages/capacitor-runtime/src/standalone-bridge.ts`
- 修改：`packages/capacitor-runtime/src/standalone-app-runtime.ts`
- 新增：`packages/capacitor-runtime/src/standalone-production-service.test.ts`
- 修改：`android/app/src/main/java/com/hongtai/aiagent/bridge/LocalFilesPlugin.kt`
- 修改/新增对应 JVM 单元测试。

**步骤：**

- [ ] 先增加失败测试：创建、列举、读取、保存计划、失败恢复与重启恢复。
- [ ] 在 `AppRuntime` 增加单一 `production` 服务，避免页面直接调用原生插件。
- [ ] 制作记录固定存储于 `productions/<projectId>/project.json`、`plan.json` 和 `events.jsonl`。
- [ ] 给 `LocalFiles` 增加受约束的 production 根目录方法，不暴露任意路径。
- [ ] 组合现有 `analysis.get(taskId)` 与 AI Provider；不复制拆解逻辑。
- [ ] 将 `features.create` 切换为 `available`，`assets` 与 `publish` 继续为 `planned`。
- [ ] 运行定向测试、类型检查、Android 单测与 staged diff 检查。
- [ ] 提交：`feat(runtime): add private production projects`

## Task 3：Android 素材导入、TTS 与 Media3 渲染

**文件：**

- 新增：`android/app/src/main/java/com/hongtai/aiagent/production/ProductionRuntimePlugin.kt`
- 新增：`android/app/src/main/java/com/hongtai/aiagent/production/ProductionMediaStore.kt`
- 新增：`android/app/src/main/java/com/hongtai/aiagent/production/ProductionRenderer.kt`
- 新增：`android/app/src/main/java/com/hongtai/aiagent/production/ProductionPlanParser.kt`
- 修改：`android/app/src/main/java/com/hongtai/aiagent/MainActivity.kt`
- 修改：`android/app/build.gradle`
- 修改：`packages/capacitor-runtime/src/standalone-bridge.ts`
- 修改：`tests/android-plugin-boundary.test.ts`
- 新增对应 JVM 与 instrumentation 测试。

**步骤：**

- [ ] 先增加失败测试：插件注册、计划解析、素材白名单、时长边界、静态图片帧率和安全输出路径。
- [ ] 使用系统文件选择器一次导入 3–12 个素材，并立即复制到项目私有目录。
- [ ] 使用 Android 系统 TTS 按句生成旁白 WAV；不得把 TTS 文本或输出路径交给 WebView 任意指定。
- [ ] 使用 Media3 1.10.1 组合图片/视频、旁白、循环 BGM、文字覆盖与硬切；静态图片显式设置帧率。
- [ ] 渲染事件只返回项目 ID、阶段、百分比和稳定错误码。
- [ ] 输出完成后原子发布为 `output.mp4`，失败保留项目与素材但不暴露半成品。
- [ ] 运行 Android 单测、instrumentation、assembleDebug 与 staged diff 检查。
- [ ] 提交：`feat(android): render local production videos`

## Task 4：真实制作工作台

**文件：**

- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/src/pages/CreatePage.tsx`
- 新增：`apps/web/src/components/ProductionProjectCard.tsx`
- 新增：`apps/web/src/styles/pages/production-runtime.css`
- 修改：`apps/web/src/styles/global.css`
- 修改/新增页面控制器与路由测试。

**步骤：**

- [ ] 先增加失败测试：页面只能选择已成功拆解的任务，素材/计划/渲染状态来自真实 Runtime。
- [ ] 保持现有固定导航、系统栏适配、滑动手感、圆角和温润克制视觉，不重做应用外壳。
- [ ] 页面分为来源选择、经营需求、素材、制作计划、渲染与成片五个紧凑区块。
- [ ] 任何长文本都换行或省略；主要按钮统一尺寸，窄屏不重叠。
- [ ] 渲染展示真实阶段与百分比；错误进入现有顶部通知，不构造伪进度或伪成片。
- [ ] 成功后使用安全展示 URI 预览本地 MP4。
- [ ] 运行 Web 页面测试、全量 `pnpm check`、生产构建与 staged diff 检查。
- [ ] 提交：`feat(create): connect local production workbench`

## Task 5：APK 端测与交付证据

**文件：**

- 修改：`docs/架构与工程规范.md`
- 新增：`docs/acceptance/<日期>-local-video-production.md`

**步骤：**

- [ ] 全量运行 `pnpm check`、Web 生产构建、Android 单测、instrumentation 与 `assembleDebug`。
- [ ] 扫描 U+FFFD、`.env`、API Key 与敏感本机路径；`.env` 只用于 CLI 回归，不编译进 APK。
- [ ] 在模拟器安装新 APK，完成一次真实内容拆解。
- [ ] 导入至少一张图片与一个视频，生成正式制作计划，完成本地 TTS 与 Media3 合成。
- [ ] 用 `ffprobe` 验证输出 MP4 的 H.264/AAC、9:16 展示方向、时长和非空音视频流。
- [ ] 重启应用，验证制作项目、计划、素材引用与成片仍可读取。
- [ ] 记录 APK 绝对路径、SHA-256、模拟器/API 版本、测试命令和已知 Demo 限制。
- [ ] 提交：`test(apk): verify local production workflow`

## 停止条件

只有同时满足以下条件，才能停止目标：

- 内容拆解原有能力未回归，且 APK 中能得到真实 `content-analysis.v1`。
- APK 中能从已拆解任务创建制作项目、导入私有素材、生成正式计划并输出可播放 MP4。
- 自动测试、Android 构建、模拟器端测、输出媒体探测和重启恢复全部有当前构建证据。
- 工作树只剩任务前已存在的无关 `.superpowers/`，所有本轮阶段均已本地提交。
